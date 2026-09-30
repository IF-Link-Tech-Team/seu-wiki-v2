// Admin identity: IF.Link 统一账户 + 社区管理员角色（决策 13.7）。原 ADMIN_PASSWORD 单密码和飞书
// OAuth 白名单两条路已退役——密码是共享凭据，审计不知道谁在操作。
// 现在的链路：/admin/login → /api/logto/sign-in（与 member 共用同一 Logto 应用和 member/oidc.ts）
// → bootstrap-complete 里按 roles claim 判定 community_admin/super_admin → 签发 admin 会话。
// admin_users 行按 Accounts UUID 自动建档；审计 actor 记录邮箱/UUID，不再是 admin:<行号>。
// 启用统一账户后，信任 admin cookie 前也查 Accounts 撤销目录（60s 缓存，不可用 fail closed）。
// 开发降级 DEV_ADMIN_BYPASS 只在非生产生效；生产设置它会被拒绝启动（config.assertProductionSecrets）。
import { randomBytes } from "node:crypto";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { isRevoked, RevocationUnavailable } from "../member/accounts.ts";
import { memberAuthConfig } from "../member/config.ts";

export const SESSION_COOKIE = "aihot_admin";
export const SESSION_DAYS = 30;

export interface AdminPrincipal {
  userId: number | null;
  name: string;
  csrf: string;
  dev: boolean;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookie(name: string, value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

/** Only admin paths on this site; anything else (other hosts, protocol-relative) falls back to /admin. */
export function safeReturn(target: string): string {
  let path = target;
  // A proxy's login redirect may pass the whole original URL; keep only its path and query.
  if (/^https?:\/\//i.test(path)) {
    try {
      const u = new URL(path);
      path = `${u.pathname}${u.search}`;
    } catch {
      return "/admin";
    }
  }
  return /^\/admin(\/|\?|$)/.test(path) && !path.startsWith("//") ? path : "/admin";
}

/** IF.Link 建档后的管理员会话：admin_users 按 Accounts UUID（没有则邮箱）自动建档。 */
export async function createAdminSessionForIdentity(
  identity: { uuid: string; sub: string; sid: string | null; iat: number | null; email: string | null; name: string | null },
  userAgent: string | undefined,
): Promise<{ token: string; userId: number }> {
  const email = identity.email?.toLowerCase() ?? null;
  const [user] = await sql<{ id: number }[]>`
    INSERT INTO admin_users (accounts_uuid, email, display_name, last_login_at)
    VALUES (${identity.uuid}, ${email}, ${identity.name ?? email}, now())
    ON CONFLICT (accounts_uuid) DO UPDATE SET email = coalesce(EXCLUDED.email, admin_users.email),
      display_name = coalesce(EXCLUDED.display_name, admin_users.display_name), last_login_at = now()
    RETURNING id`;
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO admin_sessions (id_hash, user_id, csrf_token, sub, sid, iat, expires_at, user_agent)
            VALUES (${sha256(token)}, ${user!.id}, ${randomBytes(18).toString("base64url")}, ${identity.sub}, ${identity.sid}, ${identity.iat},
                    ${new Date(Date.now() + SESSION_DAYS * 86400_000)}, ${userAgent?.slice(0, 300) ?? null})`;
  return { token, userId: user!.id };
}

export async function sessionPrincipal(cookieHeader: string | undefined): Promise<AdminPrincipal | null> {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (token) {
    const [row] = await sql<{ user_id: number; csrf_token: string; sub: string | null; sid: string | null; iat: string | null; name: string | null; email: string | null; uuid: string | null }[]>`
      SELECT s.user_id, s.csrf_token, s.sub, s.sid, s.iat, u.display_name AS name, u.email, u.accounts_uuid AS uuid
      FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
      WHERE s.id_hash = ${sha256(token)} AND s.expires_at > now()`;
    if (row) {
      // 启用统一账户后：没有 sub 的旧会话一律失效；有 sub 的每次先查中心撤销目录。
      const cfg = memberAuthConfig();
      if (cfg) {
        if (!row.sub) return null;
        try {
          if (await isRevoked(cfg, { sub: row.sub, sid: row.sid, iat: row.iat === null ? null : Number(row.iat) })) return null;
        } catch (error) {
          if (error instanceof RevocationUnavailable) return null; // fail closed
          throw error;
        }
      }
      return { userId: row.user_id, name: row.email ?? row.name ?? `admin:${row.user_id}`, csrf: row.csrf_token, dev: false };
    }
  }
  if (config.devAdmin && config.environmentName !== "production") return { userId: null, name: config.devAdmin.displayName, csrf: "dev", dev: true };
  return null;
}

export async function endSession(cookieHeader: string | undefined) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE];
  if (token) await sql`DELETE FROM admin_sessions WHERE id_hash = ${sha256(token)}`;
}

/** Every manual change: who, when, what, why. */
export async function audit(actor: string, action: string, subject: string | null, reason: string | null, before: unknown, after: unknown, requestId?: string) {
  await sql`INSERT INTO audit_log (actor, action, subject, reason, before, after, request_id)
            VALUES (${actor}, ${action}, ${subject}, ${reason}, ${before === null || before === undefined ? null : sql.json(before as never)},
                    ${after === null || after === undefined ? null : sql.json(after as never)}, ${requestId ?? null})`;
}

export function actorOf(p: AdminPrincipal): string {
  return p.dev ? `dev:${p.name}` : `admin:${p.name}`;
}
