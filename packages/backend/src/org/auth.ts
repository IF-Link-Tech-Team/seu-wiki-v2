// 组织账户的认证：与 admin 完全隔离（独立的 cookie、org_sessions 表和守卫）。
// 成员令牌由管理员在后台创建组织/添加成员时生成，只在创建时完整显示一次，库里只存哈希；
// 登录用令牌换 org_sessions 会话（仿 admin_sessions：哈希存储、CSRF token、30 天）。
import { randomBytes } from "node:crypto";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { parseCookies } from "../admin/auth.ts";

export const ORG_SESSION_COOKIE = "seuwiki_org";
export const ORG_SESSION_DAYS = 30;

export interface OrgPrincipal {
  memberId: number;
  orgId: number;
  orgName: string;
  role: "owner" | "editor";
  name: string;
  csrf: string;
}

/** 成员令牌：suo_ 前缀便于识别和泄漏扫描；只在创建时完整出现一次。 */
export function newMemberToken(): string {
  return `suo_${randomBytes(24).toString("base64url")}`;
}

export async function orgLogin(token: string, userAgent: string | undefined): Promise<{ session: string; principal: OrgPrincipal } | null> {
  const [m] = await sql<{ id: number; org_id: number; role: "owner" | "editor"; name: string; org_name: string }[]>`
    SELECT m.id, m.org_id, m.role, m.name, o.name AS org_name
    FROM org_members m JOIN organizations o ON o.id = m.org_id WHERE m.token_hash = ${sha256(token)}`;
  if (!m) return null;
  const session = randomBytes(32).toString("base64url");
  const csrf = randomBytes(18).toString("base64url");
  await sql`INSERT INTO org_sessions (id_hash, member_id, csrf_token, expires_at, user_agent)
            VALUES (${sha256(session)}, ${m.id}, ${csrf}, ${new Date(Date.now() + ORG_SESSION_DAYS * 86400_000)}, ${userAgent?.slice(0, 300) ?? null})`;
  return { session, principal: { memberId: m.id, orgId: m.org_id, orgName: m.org_name, role: m.role, name: m.name, csrf } };
}

export async function orgSessionPrincipal(cookieHeader: string | undefined): Promise<OrgPrincipal | null> {
  const token = parseCookies(cookieHeader)[ORG_SESSION_COOKIE];
  if (!token) return null;
  const [row] = await sql<{ member_id: number; csrf_token: string; org_id: number; role: "owner" | "editor"; name: string; org_name: string }[]>`
    SELECT s.member_id, s.csrf_token, m.org_id, m.role, m.name, o.name AS org_name
    FROM org_sessions s JOIN org_members m ON m.id = s.member_id JOIN organizations o ON o.id = m.org_id
    WHERE s.id_hash = ${sha256(token)} AND s.expires_at > now()`;
  if (!row) return null;
  return { memberId: row.member_id, orgId: row.org_id, orgName: row.org_name, role: row.role, name: row.name, csrf: row.csrf_token };
}

export async function endOrgSession(cookieHeader: string | undefined) {
  const token = parseCookies(cookieHeader)[ORG_SESSION_COOKIE];
  if (token) await sql`DELETE FROM org_sessions WHERE id_hash = ${sha256(token)}`;
}

export function orgActorOf(p: OrgPrincipal): string {
  return `org:${p.orgId}:${p.name || p.memberId}`;
}
