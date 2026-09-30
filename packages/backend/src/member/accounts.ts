// Accounts 的服务端对接：M2M token（client_credentials，按有效期缓存）、sub → Accounts UUID 解析、
// 统一会话撤销目录（每次信任本地 member cookie 前查询；60s 短缓存；接口不可用 fail closed）、
// back-channel 撤销转发。浏览器永远碰不到这些接口。
import { memberAuthConfig, type MemberAuthConfig } from "./config.ts";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function m2mToken(cfg: MemberAuthConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  const res = await fetch(`${cfg.logtoEndpoint}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: cfg.m2mAppId,
      client_secret: cfg.m2mAppSecret,
      resource: cfg.accountsApiResource,
      scope: "users:resolve",
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`m2m token failed: ${res.status}`);
  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("m2m token response missing access_token");
  cachedToken = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 300) * 1000 };
  return body.access_token;
}

/** sub → Accounts UUID；未建档返回 null（该端点不建用户，调用方引导 bootstrap）。 */
export async function resolveAccountsUuid(cfg: MemberAuthConfig, subject: string): Promise<{ uuid: string; email: string | null; name: string | null } | null> {
  const res = await fetch(`${cfg.accountsUrl}/internal/v1/users/by-subject?subject=${encodeURIComponent(subject)}`, {
    headers: { authorization: `Bearer ${await m2mToken(cfg)}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`by-subject failed: ${res.status}`);
  const body = (await res.json()) as Record<string, unknown>;
  // Accounts 实际返回 { user: { id, display_name, email, … } }；兼容顶层平铺的两种写法。
  const u = (body.user ?? body) as { id?: string; uuid?: string; email?: string; name?: string; displayName?: string; display_name?: string };
  const uuid = u.uuid ?? u.id;
  return uuid ? { uuid, email: u.email ?? null, name: u.display_name ?? u.displayName ?? u.name ?? null } : null;
}

export class RevocationUnavailable extends Error {}

// 撤销目录的 60s 短缓存；键是 sub+sid+iat 三元组。
const revocationCache = new Map<string, { at: number; revoked: boolean }>();

/** 会话是否已被中心撤销。接口不可用时报错（调用方 fail closed）。 */
export async function isRevoked(cfg: MemberAuthConfig, s: { sub: string; sid: string | null; iat: number | null }): Promise<boolean> {
  const key = `${s.sub}|${s.sid ?? ""}|${s.iat ?? ""}`;
  const hit = revocationCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.revoked;
  const params = new URLSearchParams({ subject: s.sub });
  if (s.sid) params.set("sid", s.sid);
  if (s.iat) params.set("iat", String(s.iat));
  let res: Response;
  try {
    res = await fetch(`${cfg.accountsUrl}/internal/v1/logto/session-revocation?${params}`, {
      headers: { authorization: `Bearer ${await m2mToken(cfg)}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new RevocationUnavailable(String(error));
  }
  if (!res.ok) throw new RevocationUnavailable(`session-revocation ${res.status}`);
  const body = (await res.json()) as { revoked?: boolean };
  const revoked = body.revoked === true;
  if (revocationCache.size >= 1000) revocationCache.clear();
  revocationCache.set(key, { at: Date.now(), revoked });
  return revoked;
}

/** back-channel logout 通知验证通过后，转发给 Accounts 记录撤销。 */
export async function forwardRevocation(cfg: MemberAuthConfig, payload: { sub?: string; sid?: string; iat?: number; jti: string }): Promise<void> {
  const res = await fetch(`${cfg.accountsUrl}/internal/v1/logto/session-revocation`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await m2mToken(cfg)}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`forward revocation failed: ${res.status}`);
}
