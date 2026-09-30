// 平台侧的组织管理与投稿审核：组织入驻核验（创建时生成 owner 令牌和对应的 external 信源）、
// 审核队列（新投稿 + 挂在原条目上的变更申请）。批准后投稿进入 articles/publications，
// 走与普通采集一致的后续流程（queueProcessing：分析、判重、归组）。
import { audit } from "./auth.ts";
import { sql } from "../db.ts";
import { sha256, newArticleId } from "../lib/ids.ts";
import { itemUrl } from "../publication/links.ts";
import { upsertMaterial } from "../content/materials.ts";
import { queueProcessing } from "../jobs/content.ts";
import { setVisibility } from "./content.ts";
import { newMemberToken } from "../org/auth.ts";
import { postView, type OrgPostRow, type PostInput } from "../org/posts.ts";

export class OrgAdminError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const text = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim().slice(0, max) : "";
  return s || null;
};

export async function listOrganizations() {
  return sql`
    SELECT o.id, o.name, o.intro, o.contact, o.verified, o.source_id, o.created_at,
           (SELECT count(*)::int FROM org_posts p WHERE p.org_id = o.id) AS posts,
           (SELECT count(*)::int FROM org_members m WHERE m.org_id = o.id) AS members
    FROM organizations o ORDER BY o.created_at DESC LIMIT 500`;
}

/**
 * 创建组织：同名的 external 信源（first_party、T1_5、enabled=false——它从不被采集，只是内容的
 * 来源身份）和第一任 owner 的令牌。令牌只在这次响应里完整返回。
 */
export async function createOrganization(input: Record<string, unknown>, actor: string) {
  const name = text(input.name, 60);
  if (!name) throw new OrgAdminError(400, "组织名称必填");
  const sourceId = `org-${sha256(name).slice(0, 12)}`;
  const org = await sql.begin(async (tx) => {
    await tx`INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode, interval_minutes, enabled, health, next_fetch_at, tags)
             VALUES (${sourceId}, ${name}, 'external', '{}'::jsonb, 'T1_5', true, 'editorial', 1440, false, 'ok', '2100-01-01', ${["org"]})
             ON CONFLICT (id) DO NOTHING`;
    const [row] = await tx<{ id: number }[]>`
      INSERT INTO organizations (name, intro, contact, source_id) VALUES (${name}, ${text(input.intro, 500)}, ${text(input.contact, 120)}, ${sourceId})
      RETURNING id`;
    return row!;
  });
  const owner = await addOrgMember(org.id, { name: "负责人", role: "owner" }, actor);
  await audit(actor, "org.create", `org:${org.id}`, null, null, { name, sourceId });
  return { id: org.id, name, ownerToken: owner.token };
}

export async function listOrgMembers(orgId: number) {
  return sql`SELECT id, name, role, created_at FROM org_members WHERE org_id = ${orgId} ORDER BY created_at`;
}

/** 加成员 / 换届移交（把现有 owner 降为 editor）。令牌只在这次响应里完整返回。 */
export async function addOrgMember(orgId: number, input: Record<string, unknown>, actor: string) {
  const role = input.role === "owner" ? "owner" : "editor";
  const name = text(input.name, 60) ?? "";
  const [org] = await sql<{ id: number }[]>`SELECT id FROM organizations WHERE id = ${orgId}`;
  if (!org) throw new OrgAdminError(404, "组织不存在");
  const token = newMemberToken();
  const member = await sql.begin(async (tx) => {
    if (role === "owner") await tx`UPDATE org_members SET role = 'editor' WHERE org_id = ${orgId} AND role = 'owner'`;
    const [row] = await tx<{ id: number }[]>`INSERT INTO org_members (org_id, name, role, token_hash) VALUES (${orgId}, ${name}, ${role}, ${sha256(token)}) RETURNING id`;
    return row!;
  });
  await audit(actor, "org.member.add", `org:${orgId}`, null, null, { memberId: member.id, role, name });
  return { id: member.id, role, token };
}

export async function setOrgVerified(orgId: number, verified: boolean, actor: string) {
  const rows = await sql`UPDATE organizations SET verified = ${verified}, updated_at = now() WHERE id = ${orgId} RETURNING id`;
  if (rows.length === 0) throw new OrgAdminError(404, "组织不存在");
  await audit(actor, verified ? "org.verify" : "org.unverify", `org:${orgId}`, null, null, { verified });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 审核队列
// ---------------------------------------------------------------------------

export async function listOrgPosts(filter: { status?: string }) {
  const status = ["pending", "published", "rejected"].includes(filter.status ?? "") ? filter.status! : null;
  // 默认是待办队列：新投稿 + 已发布但挂着变更申请的；显式 status 只看该状态。
  const rows = await sql<(OrgPostRow & { org_name: string })[]>`
    SELECT p.*, o.name AS org_name FROM org_posts p JOIN organizations o ON o.id = p.org_id
    WHERE ${status ? sql`p.status = ${status}` : sql`p.status = 'pending' OR p.pending_change IS NOT NULL`}
    ORDER BY (p.status = 'pending' OR p.pending_change IS NOT NULL) DESC, p.updated_at DESC LIMIT 200`;
  return rows.map((r) => ({ ...postView(r), orgName: r.org_name }));
}

async function adminPost(id: number): Promise<OrgPostRow & { org_name: string; source_id: string | null }> {
  const [p] = await sql<(OrgPostRow & { org_name: string; source_id: string | null })[]>`
    SELECT p.*, o.name AS org_name, o.source_id FROM org_posts p JOIN organizations o ON o.id = p.org_id WHERE p.id = ${id}`;
  if (!p) throw new OrgAdminError(404, "投稿不存在");
  return p;
}

/** 投稿正文 → 条目正文：结构化字段在前，正文介绍在后，海报一行链接收尾。 */
function articleBody(p: OrgPostRow, orgName: string): string {
  const lines = [
    `主办方：${orgName}`,
    p.event_at ? `时间：${p.event_at.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}` : null,
    p.location ? `地点：${p.location}` : null,
    p.audience ? `面向：${p.audience}` : null,
    p.fee ? `费用：${p.fee}` : null,
    p.signup ? `报名：${p.signup}` : null,
    "",
    p.body,
    p.poster_key ? `\n海报：${itemUrl("").replace(/\/items\/$/, "")}/api/org/poster/${p.poster_key}` : null,
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/** 批准新投稿：进统一内容库（upsertMaterial + queueProcessing），状态置 published。 */
export async function approveOrgPost(id: number, actor: string) {
  const p = await adminPost(id);
  if (p.status !== "pending") throw new OrgAdminError(409, "这条投稿已经审过了");
  const articleId = newArticleId();
  const bodyText = articleBody(p, p.org_name);
  await upsertMaterial({
    id: articleId,
    sourceId: p.source_id!,
    identityKey: `org-post:${p.id}`,
    url: itemUrl(articleId),
    title: p.title,
    author: p.org_name,
    language: "zh",
    publishedAt: new Date(),
    bodyText,
    bodyHtml: null,
    bodyStatus: "ok",
    via: "ingest",
  });
  await sql`UPDATE org_posts SET status = 'published', article_id = ${articleId}, review_note = NULL, updated_at = now() WHERE id = ${id}`;
  await queueProcessing(articleId);
  await audit(actor, "org.post.approve", `org_post:${id}`, null, null, { articleId });
  return { articleId };
}

export async function rejectOrgPost(id: number, reason: string, actor: string) {
  const p = await adminPost(id);
  if (p.status !== "pending") throw new OrgAdminError(409, "这条投稿已经审过了");
  if (!reason.trim()) throw new OrgAdminError(400, "驳回要填理由");
  await sql`UPDATE org_posts SET status = 'rejected', review_note = ${reason.trim().slice(0, 300)}, updated_at = now() WHERE id = ${id}`;
  await audit(actor, "org.post.reject", `org_post:${id}`, reason.trim(), { title: p.title }, null);
  return { ok: true };
}

/**
 * 变更申请的批准：update/reschedule 把申请里的完整表单落回原条目，原文按同一 identityKey 出新
 * 版本并重走分析；cancel 把原内容条目下架。驳回只清掉申请，已发布内容不动。
 */
export async function resolveOrgPostChange(id: number, approve: boolean, note: string, actor: string) {
  const p = await adminPost(id);
  if (p.status !== "published" || !p.pending_change) throw new OrgAdminError(409, "没有待审核的变更申请");
  const change = p.pending_change;
  if (!approve) {
    await sql`UPDATE org_posts SET pending_change = NULL, updated_at = now() WHERE id = ${id}`;
    await audit(actor, "org.post.change_reject", `org_post:${id}`, note || null, change, null);
    return { ok: true };
  }
  if (change.type === "cancel") {
    if (p.article_id) await setVisibility(p.article_id, { visibility: "withdrawn", reason: `组织申请取消：${change.reason ?? ""}`.trim(), version: 0 }, actor);
    await sql`UPDATE org_posts SET pending_change = NULL, updated_at = now() WHERE id = ${id}`;
    await audit(actor, "org.post.change_approve", `org_post:${id}`, note || null, null, { type: "cancel" });
    return { ok: true, cancelled: true };
  }
  const patch = (change.patch ?? {}) as PostInput; // 申请时已经过 cleanPostInput 校验，这里直接用
  const next = await sql.begin(async (tx) => {
    const [row] = await tx<OrgPostRow[]>`
      UPDATE org_posts SET title = ${patch.title}, event_at = ${patch.eventAt}, location = ${patch.location}, audience = ${patch.audience},
        fee = ${patch.fee}, signup = ${patch.signup}, body = ${patch.body}, poster_key = ${patch.posterKey}, pending_change = NULL, updated_at = now()
      WHERE id = ${id} RETURNING *`;
    return row!;
  });
  if (p.article_id) {
    // 更新原条目：同一 identityKey 进来的是新版本，队列按 revision 重走分析与归组。
    await upsertMaterial({
      sourceId: p.source_id!,
      identityKey: `org-post:${p.id}`,
      url: itemUrl(p.article_id),
      title: next.title,
      author: p.org_name,
      language: "zh",
      publishedAt: new Date(),
      bodyText: articleBody(next, p.org_name),
      bodyHtml: null,
      bodyStatus: "ok",
      via: "ingest",
    });
    await queueProcessing(p.article_id);
  }
  await audit(actor, "org.post.change_approve", `org_post:${id}`, note || null, null, { type: change.type });
  return { ok: true };
}

export async function pendingOrgPostCount(): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM org_posts WHERE status = 'pending' OR pending_change IS NOT NULL`;
  return row!.n;
}
