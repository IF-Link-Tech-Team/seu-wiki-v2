// 组织侧的投稿：新建（pending）、待审核期间的直接修改、已发布后的变更申请（改期/修改/取消，
// 挂在原条目的 pending_change 上等管理员批准），以及海报上传（存 stored_files + dataDir/uploads）。
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { beijingDate, beijingTime } from "@aihot/contracts/time";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import { rasterImageType } from "../media/raster.ts";
import { audit } from "../admin/auth.ts";
import { recordCandidate } from "../taxonomy/terms.ts";
import { orgActorOf, type OrgPrincipal } from "./auth.ts";

export interface PostInput {
  title: string;
  eventAt: string | null;
  location: string | null;
  audience: string | null;
  fee: string | null;
  signup: string | null;
  body: string;
  posterKey: string | null;
  /** 建议新增的主题标签（进词表候选池，不进本条内容）。 */
  suggestedTags: string[];
}

export interface OrgPostRow {
  id: number;
  org_id: number;
  title: string;
  event_at: Date | null;
  location: string | null;
  audience: string | null;
  fee: string | null;
  signup: string | null;
  body: string;
  poster_key: string | null;
  suggested_tags: string[];
  status: "pending" | "published" | "rejected";
  review_note: string | null;
  article_id: string | null;
  pending_change: { type: "update" | "reschedule" | "cancel"; patch?: Partial<PostInput>; reason?: string; requestedAt?: string } | null;
  created_at: Date;
  updated_at: Date;
}

export class OrgError extends Error {
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

/** 表单字段的清洗与校验；eventAt 接受「YYYY-MM-DD HH:mm」或「YYYY-MM-DD」（按北京时间理解）。 */
export function cleanPostInput(input: Record<string, unknown>): PostInput {
  const title = text(input.title, 120);
  if (!title) throw new OrgError(400, "标题必填");
  const body = text(input.body, 10000);
  if (!body) throw new OrgError(400, "正文必填");
  let eventAt: Date | null = null;
  const rawAt = text(input.eventAt, 30);
  if (rawAt) {
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(rawAt);
    eventAt = m ? new Date(`${m[1]}T${m[2] ?? "00:00"}:00+08:00`) : null;
    if (!m || Number.isNaN(eventAt!.getTime())) throw new OrgError(400, "活动时间格式应为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm");
  }
  return {
    title,
    eventAt: eventAt ? eventAt.toISOString() : null,
    location: text(input.location, 120),
    audience: text(input.audience, 120),
    fee: text(input.fee, 60),
    signup: text(input.signup, 300),
    body,
    posterKey: text(input.posterKey, 200),
    suggestedTags: String(input.suggestedTags ?? "").split(/[,，]/).map((s) => s.trim().slice(0, 30)).filter(Boolean).slice(0, 5),
  };
}

export function postView(p: OrgPostRow) {
  return {
    id: p.id,
    title: p.title,
    eventAt: p.event_at?.toISOString() ?? null,
    location: p.location,
    audience: p.audience,
    fee: p.fee,
    signup: p.signup,
    body: p.body,
    posterUrl: p.poster_key ? posterUrl(p.poster_key) : null,
    suggestedTags: p.suggested_tags ?? [],
    status: p.status,
    reviewNote: p.review_note,
    articleId: p.article_id,
    pendingChange: p.pending_change,
    /** event_at 已过：已结束，退到历史。 */
    ended: !!p.event_at && p.event_at.getTime() < Date.now(),
    createdAt: p.created_at.toISOString(),
    updatedAt: p.updated_at.toISOString(),
  };
}

export function posterUrl(key: string): string {
  return `/api/org/poster/${key}`;
}

async function ownPost(org: OrgPrincipal, id: number): Promise<OrgPostRow> {
  const [p] = await sql<OrgPostRow[]>`SELECT * FROM org_posts WHERE id = ${id} AND org_id = ${org.orgId}`;
  if (!p) throw new OrgError(404, "投稿不存在");
  return p;
}

export async function listMyPosts(org: OrgPrincipal) {
  const rows = await sql<OrgPostRow[]>`SELECT * FROM org_posts WHERE org_id = ${org.orgId} ORDER BY created_at DESC LIMIT 200`;
  return rows.map(postView);
}

export async function getMyPost(org: OrgPrincipal, id: number) {
  return postView(await ownPost(org, id));
}

export async function createPost(org: OrgPrincipal, input: Record<string, unknown>) {
  if (!(await verified(org.orgId))) throw new OrgError(403, "组织还未通过平台核验，暂不能投稿");
  const p = cleanPostInput(input);
  if (p.posterKey) await requirePoster(p.posterKey);
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO org_posts (org_id, title, event_at, location, audience, fee, signup, body, poster_key, suggested_tags, created_by)
    VALUES (${org.orgId}, ${p.title}, ${p.eventAt}, ${p.location}, ${p.audience}, ${p.fee}, ${p.signup}, ${p.body}, ${p.posterKey}, ${p.suggestedTags}, ${org.memberId})
    RETURNING id`;
  // 组织建议的标签进词表候选池（同名计数，≥3 进审核队列）。
  for (const name of p.suggestedTags) await recordCandidate(name, "org", `/org-post-${row!.id}`);
  await audit(orgActorOf(org), "org.post.create", `org_post:${row!.id}`, null, null, { title: p.title });
  return { id: row!.id };
}

/** 待审核的投稿可以直接改；已发布的只能提交变更申请（更新原条目，不重新发布）。 */
export async function updatePost(org: OrgPrincipal, id: number, input: Record<string, unknown>) {
  const post = await ownPost(org, id);
  if (post.status !== "pending") throw new OrgError(409, "已提交审核结论的投稿不能直接改，请用变更申请");
  const p = cleanPostInput(input);
  if (p.posterKey) await requirePoster(p.posterKey);
  await sql`UPDATE org_posts SET title = ${p.title}, event_at = ${p.eventAt}, location = ${p.location}, audience = ${p.audience},
            fee = ${p.fee}, signup = ${p.signup}, body = ${p.body}, poster_key = ${p.posterKey}, updated_at = now() WHERE id = ${id}`;
  await audit(orgActorOf(org), "org.post.update", `org_post:${id}`, null, { title: post.title }, { title: p.title });
  return { ok: true };
}

export async function requestChange(org: OrgPrincipal, id: number, input: Record<string, unknown>) {
  const post = await ownPost(org, id);
  if (post.status !== "published") throw new OrgError(409, "只有已发布的投稿需要变更申请");
  if (post.pending_change) throw new OrgError(409, "已有一条待审核的变更申请");
  const type = input.type;
  if (type !== "update" && type !== "reschedule" && type !== "cancel") throw new OrgError(400, "未知的变更类型");
  const change = {
    type,
    ...(type === "cancel" ? {} : { patch: cleanPostInput({ ...postToInput(post), ...(input.patch as Record<string, unknown> ?? {}) }) }),
    reason: text(input.reason, 300),
    requestedAt: new Date().toISOString(),
  };
  await sql`UPDATE org_posts SET pending_change = ${sql.json(change as never)}, updated_at = now() WHERE id = ${id}`;
  await audit(orgActorOf(org), "org.post.change_request", `org_post:${id}`, change.reason, null, { type });
  return { ok: true };
}

export async function retractChange(org: OrgPrincipal, id: number) {
  const post = await ownPost(org, id);
  if (!post.pending_change) throw new OrgError(409, "没有待审核的变更申请");
  await sql`UPDATE org_posts SET pending_change = NULL, updated_at = now() WHERE id = ${id}`;
  await audit(orgActorOf(org), "org.post.change_retract", `org_post:${id}`, null, post.pending_change, null);
  return { ok: true };
}

function postToInput(p: OrgPostRow): Record<string, unknown> {
  return {
    // event_at 以北京时间回填表单（cleanPostInput 也按北京时间解析）。
    title: p.title, eventAt: p.event_at ? `${beijingDate(p.event_at)} ${beijingTime(p.event_at)}` : null,
    location: p.location, audience: p.audience, fee: p.fee, signup: p.signup, body: p.body, posterKey: p.poster_key,
  };
}

async function verified(orgId: number): Promise<boolean> {
  const [o] = await sql<{ verified: boolean }[]>`SELECT verified FROM organizations WHERE id = ${orgId}`;
  return !!o?.verified;
}

const MAX_POSTER_BYTES = 5 * 1024 * 1024;

/** 海报：PNG/JPEG/WebP，≤ 5MB；内容哈希命名，公开地址永久缓存。 */
export async function uploadPoster(data: Buffer): Promise<{ key: string; url: string }> {
  if (data.length > MAX_POSTER_BYTES) throw new OrgError(400, "海报最大 5MB");
  if (!["image/png", "image/jpeg", "image/webp"].includes(await rasterImageType(data) ?? "")) throw new OrgError(400, "需要 PNG、JPG 或 WebP 图片");
  const meta = await sharp(data).metadata().catch(() => null);
  if (!meta || !["png", "jpeg", "webp"].includes(meta.format ?? "")) throw new OrgError(400, "需要 PNG、JPG 或 WebP 图片");
  const ext = meta.format === "jpeg" ? "jpg" : meta.format!;
  const key = `org-poster-${sha256(data).slice(0, 16)}.${ext}`;
  await mkdir(path.join(config.dataDir, "uploads"), { recursive: true });
  await writeFile(path.join(config.dataDir, "uploads", key), data);
  await sql`INSERT INTO stored_files (key, content_type, bytes, purpose)
            VALUES (${key}, ${meta.format === "jpeg" ? "image/jpeg" : `image/${meta.format}`}, ${data.length}, 'org_poster')
            ON CONFLICT (key) DO NOTHING`;
  return { key, url: posterUrl(key) };
}

async function requirePoster(key: string) {
  const [f] = await sql<{ key: string }[]>`SELECT key FROM stored_files WHERE key = ${key} AND purpose = 'org_poster'`;
  if (!f) throw new OrgError(400, "海报不存在，请重新上传");
}
