// 手搓的 OIDC 适配层（Fastify，不用 Logto SDK）：发起授权、回调换码验签、back-channel logout
// token 验证。签名验证走 Logto 的 JWKS；issuer/audience/nonce/iat/jti/logout event 都验。
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { canonicalizeCallbackUrl } from "iflink-community-auth";
import { memberAuthConfig, type MemberAuthConfig } from "./config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";

export class OidcError extends Error {}

export const OIDC_STATE_COOKIE = "seuwiki_oidc_state";
export const OIDC_PENDING_COOKIE = "seuwiki_oidc_pending";
export const OIDC_STATE_MAX_AGE = 600;
export const OIDC_PENDING_MAX_AGE = 300;

function sign(cfg: MemberAuthConfig, value: string): string {
  return `${value}.${createHmac("sha256", cfg.cookieSecret).update(value).digest("base64url")}`;
}

function unsign(cfg: MemberAuthConfig, signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf(".");
  if (i <= 0) return null;
  const value = signed.slice(0, i);
  const expected = Buffer.from(sign(cfg, value).slice(i + 1));
  const given = Buffer.from(signed.slice(i + 1));
  return expected.length === given.length && timingSafeEqual(expected, given) ? value : null;
}

export interface OidcState {
  state: string;
  nonce: string;
  issuedAt: number;
}

/** 发起授权：state+nonce 写一次性 cookie，返回 Logto 授权地址。 */
export function beginSignIn(cfg: MemberAuthConfig): { url: string; cookieValue: string } {
  const s: OidcState = { state: randomBytes(16).toString("base64url"), nonce: randomBytes(16).toString("base64url"), issuedAt: Date.now() };
  const url = new URL(`${cfg.logtoEndpoint}/oidc/auth`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("redirect_uri", `${cfg.baseUrl}/api/logto/sign-in-callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile roles");
  url.searchParams.set("state", s.state);
  // prompt=none 是静默 SSO；本站第一版只做显式登录。
  url.searchParams.set("nonce", s.nonce);
  return { url: url.toString(), cookieValue: sign(cfg, JSON.stringify(s)) };
}

export interface OidcIdentity {
  sub: string;
  sid: string | null;
  iat: number | null;
  email: string | null;
  name: string | null;
  /** roles claim（scope roles；id_token 与 userinfo 的并集），后台授权判断用。 */
  roles: string[];
}

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
function jwks(endpoint: string) {
  let j = jwksCache.get(endpoint);
  if (!j) {
    j = createRemoteJWKSet(new URL(`${endpoint}/oidc/jwks`));
    jwksCache.set(endpoint, j);
  }
  return j;
}

/** Logto 自托管的 issuer 习惯：endpoint 本身、带尾斜杠、或 endpoint + /oidc。 */
function issuerCandidates(endpoint: string): string[] {
  const base = endpoint.replace(/\/+$/, "");
  return [base, `${base}/`, `${base}/oidc`, `${base}/oidc/`];
}

/**
 * 回调：用配置的 LOGTO_BASE_URL 重建公网 URL（不信 Host 头），验 state，换 code，
 * 验 id_token（JWKS/issuer/audience/nonce），取 userInfo；claims.sub 与 userInfo.sub
 * 同时存在但不一致时 fail closed。通过后返回身份，并给出 pending cookie（bootstrap 用）。
 */
export async function completeSignIn(cfg: MemberAuthConfig, requestUrl: string, stateCookie: string | undefined): Promise<{ identity: OidcIdentity; pendingCookie: string }> {
  const url = canonicalizeCallbackUrl(requestUrl, cfg.baseUrl);
  const error = url.searchParams.get("error");
  if (error) throw new OidcError(`oidc error: ${error}`);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = unsign(cfg, stateCookie);
  if (!stored) throw new OidcError("missing oidc state cookie");
  const expected = JSON.parse(stored) as OidcState;
  if (!Number.isFinite(expected.issuedAt) || expected.issuedAt > Date.now() || Date.now() - expected.issuedAt >= OIDC_STATE_MAX_AGE * 1000) {
    throw new OidcError("expired oidc state");
  }
  if (!code || !state || state !== expected.state) throw new OidcError("state mismatch");

  const tokenRes = await fetch(`${cfg.logtoEndpoint}/oidc/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: cfg.appId,
      client_secret: cfg.appSecret,
      redirect_uri: `${cfg.baseUrl}/api/logto/sign-in-callback`,
      code,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenRes.ok) throw new OidcError(`token exchange failed: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
  if (!tokens.id_token || !tokens.access_token) throw new OidcError("token response incomplete");

  const { payload } = await jwtVerify(tokens.id_token, jwks(cfg.logtoEndpoint), {
    issuer: issuerCandidates(cfg.logtoEndpoint),
    audience: cfg.appId,
  });
  if ((payload as JWTPayload & { nonce?: string }).nonce !== expected.nonce) throw new OidcError("nonce mismatch");
  if (!payload.sub) throw new OidcError("id_token missing sub");

  const meRes = await fetch(`${cfg.logtoEndpoint}/oidc/me`, {
    headers: { authorization: `Bearer ${tokens.access_token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!meRes.ok) throw new OidcError(`userinfo failed: ${meRes.status}`);
  const me = (await meRes.json()) as { sub?: string; email?: string; name?: string; roles?: unknown };
  if (me.sub && me.sub !== payload.sub) throw new OidcError("sub mismatch between id_token and userinfo");

  const claimRoles = (payload as JWTPayload & { roles?: unknown }).roles;
  const roles = [...new Set([...(Array.isArray(claimRoles) ? claimRoles : []), ...(Array.isArray(me.roles) ? me.roles : [])])].filter((r): r is string => typeof r === "string");
  const identity: OidcIdentity = {
    sub: payload.sub,
    sid: typeof payload.sid === "string" ? payload.sid : null,
    iat: payload.iat ?? null,
    email: me.email ?? null,
    name: me.name ?? null,
    roles,
  };
  const token = randomBytes(32).toString("base64url");
  // 清理过期建档凭证；浏览器只持有随机令牌，身份和有效期由服务器保存。
  await sql`DELETE FROM member_oidc_pending WHERE expires_at <= now()`;
  await sql`INSERT INTO member_oidc_pending (id_hash, identity, expires_at)
            VALUES (${sha256(token)}, ${sql.json({ ...identity })}, now() + ${OIDC_PENDING_MAX_AGE} * interval '1 second')`;
  return { identity, pendingCookie: sign(cfg, token) };
}

/** 建档尚未完成可重试；成功后必须原子消费，不能只依靠客户端删除 cookie。 */
export async function readPendingIdentity(cfg: MemberAuthConfig, cookieValue: string | undefined): Promise<OidcIdentity | null> {
  const token = unsign(cfg, cookieValue);
  if (!token) return null;
  const [row] = await sql<{ identity: OidcIdentity }[]>`
    SELECT identity FROM member_oidc_pending WHERE id_hash = ${sha256(token)} AND expires_at > now()`;
  return row?.identity ?? null;
}

export async function consumePendingIdentity(cfg: MemberAuthConfig, cookieValue: string | undefined): Promise<OidcIdentity | null> {
  const token = unsign(cfg, cookieValue);
  if (!token) return null;
  const [row] = await sql<{ identity: OidcIdentity }[]>`
    DELETE FROM member_oidc_pending WHERE id_hash = ${sha256(token)} AND expires_at > now() RETURNING identity`;
  return row?.identity ?? null;
}

const BACKCHANNEL_LOGOUT_EVENT = "http://schemas.openid.net/event/backchannel-logout";

/**
 * back-channel logout 通知：验签名、issuer、audience、iat、jti 和 logout event。
 * 有效返回负载（转发给 Accounts），无效抛错（路由返 400，不写本地库）。
 */
export async function verifyLogoutToken(cfg: MemberAuthConfig, token: string): Promise<{ sub?: string; sid?: string; iat?: number; jti: string }> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, jwks(cfg.logtoEndpoint), { audience: cfg.appId }));
  } catch {
    throw new OidcError("invalid logout token");
  }
  const iss = payload.iss?.replace(/\/+$/, "");
  if (!iss || !issuerCandidates(cfg.logtoEndpoint).map((c) => c.replace(/\/+$/, "")).includes(iss)) throw new OidcError("issuer mismatch");
  if (typeof payload.jti !== "string" || !payload.jti) throw new OidcError("missing jti");
  if (typeof payload.iat !== "number") throw new OidcError("missing iat");
  const events = (payload as JWTPayload & { events?: Record<string, unknown> }).events;
  if (!events || !(BACKCHANNEL_LOGOUT_EVENT in events)) throw new OidcError("not a backchannel-logout event");
  if (!payload.sub && typeof payload.sid !== "string") throw new OidcError("logout token carries neither sub nor sid");
  return { sub: payload.sub, sid: typeof payload.sid === "string" ? payload.sid : undefined, iat: payload.iat, jti: payload.jti };
}
