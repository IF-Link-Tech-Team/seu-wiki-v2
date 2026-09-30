// 本站 member 会话：仿 admin_sessions（哈希存、CSRF、30 天），cookie 名 seuwiki_member，
// 与 admin（aihot_admin）和组织（seuwiki_org）完全隔离。信任本地会话前查 Accounts 撤销目录。
import { randomBytes } from "node:crypto";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { parseCookies } from "../admin/auth.ts";
import { isRevoked, RevocationUnavailable } from "./accounts.ts";
import { memberAuthConfig } from "./config.ts";

export const MEMBER_SESSION_COOKIE = "seuwiki_member";
export const MEMBER_SESSION_DAYS = 30;

export interface MemberPrincipal {
  memberId: string; // Accounts UUID
  email: string | null;
  name: string | null;
  csrf: string;
  college: string | null;
  degree: string | null;
  grade: string | null;
  interests: string[];
}

export async function createMemberSession(memberId: string, oidc: { sub: string; sid: string | null; iat: number | null }, userAgent: string | undefined): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await sql`INSERT INTO member_sessions (id_hash, member_id, csrf_token, sid, sub, iat, expires_at, user_agent)
            VALUES (${sha256(token)}, ${memberId}, ${randomBytes(18).toString("base64url")}, ${oidc.sid}, ${oidc.sub}, ${oidc.iat},
                    ${new Date(Date.now() + MEMBER_SESSION_DAYS * 86400_000)}, ${userAgent?.slice(0, 300) ?? null})`;
  return token;
}

/**
 * 读本地 member 会话。配置了 Accounts 时先查中心撤销目录（60s 缓存）；目录不可用 fail closed
 * （返回 null，而不是放行一个可能已被撤销的会话）。
 */
export async function memberPrincipal(cookieHeader: string | undefined): Promise<MemberPrincipal | null> {
  const token = parseCookies(cookieHeader)[MEMBER_SESSION_COOKIE];
  if (!token) return null;
  const [row] = await sql<{
    member_id: string; csrf_token: string; sid: string | null; sub: string; iat: string | null;
    email: string | null; display_name: string | null; college: string | null; degree: string | null; grade: string | null; interests: string[];
  }[]>`
    SELECT s.member_id, s.csrf_token, s.sid, s.sub, s.iat, m.email, m.display_name, m.college, m.degree, m.grade, m.interests
    FROM member_sessions s JOIN members m ON m.id = s.member_id
    WHERE s.id_hash = ${sha256(token)} AND s.expires_at > now()`;
  if (!row) return null;
  const cfg = memberAuthConfig();
  if (cfg) {
    try {
      if (await isRevoked(cfg, { sub: row.sub, sid: row.sid, iat: row.iat === null ? null : Number(row.iat) })) return null;
    } catch (error) {
      if (error instanceof RevocationUnavailable) return null; // fail closed
      throw error;
    }
  }
  return {
    memberId: row.member_id, email: row.email, name: row.display_name, csrf: row.csrf_token,
    college: row.college, degree: row.degree, grade: row.grade, interests: row.interests ?? [],
  };
}

export async function endMemberSession(cookieHeader: string | undefined) {
  const token = parseCookies(cookieHeader)[MEMBER_SESSION_COOKIE];
  if (token) await sql`DELETE FROM member_sessions WHERE id_hash = ${sha256(token)}`;
}

/** 建档/更新本站 member（Accounts UUID 为主键）。 */
export async function upsertMember(identity: { uuid: string; sub: string; email: string | null; name: string | null }): Promise<string> {
  const [m] = await sql<{ id: string }[]>`
    INSERT INTO members (id, logto_sub, email, display_name, last_login_at)
    VALUES (${identity.uuid}, ${identity.sub}, ${identity.email}, ${identity.name}, now())
    ON CONFLICT (id) DO UPDATE SET logto_sub = EXCLUDED.logto_sub,
      email = coalesce(EXCLUDED.email, members.email), display_name = coalesce(EXCLUDED.display_name, members.display_name),
      last_login_at = now()
    RETURNING id`;
  return m!.id;
}

/** 画像绑定（登录后从 cookie 迁入）；只写非空维度，不覆盖已有值以外的字段。 */
export async function updateMemberProfile(memberId: string, profile: { college?: string | null; degree?: string | null; grade?: string | null; interests?: string[] }) {
  const interests = (profile.interests ?? []).map((s) => String(s).trim().slice(0, 30)).filter(Boolean).slice(0, 10);
  await sql`UPDATE members SET college = ${profile.college ?? null}, degree = ${profile.degree ?? null}, grade = ${profile.grade ?? null},
            interests = ${sql.json(interests as never)}, updated_at = now() WHERE id = ${memberId}`;
}
