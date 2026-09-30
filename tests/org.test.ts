// 组织投稿平台：组织 CRUD 与令牌、投稿状态机（pending→published/rejected、变更申请挂在原条目）、
// 批准后进统一内容库、与 admin 的权限隔离（组织会话在 /api/admin/* 上是 403）、AI 辅助的 stub 与降级。
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";
import { ORG_SESSION_COOKIE, orgLogin } from "@aihot/backend/org/auth";
import { createPost, OrgError, requestChange, updatePost } from "@aihot/backend/org/posts";
import { draftOrgPost } from "@aihot/backend/org/draft";
import {
  addOrgMember, approveOrgPost, createOrganization, listOrgPosts, rejectOrgPost, resolveOrgPostChange, setOrgVerified,
} from "@aihot/backend/admin/orgs";
import { config } from "@aihot/backend/config";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const app = await buildApp();

// AI 辅助的模型桩（summarize 走 deepseek）。
const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ content: unknown }> };
  const user = String(body.messages[body.messages.length - 1]!.content);
  if (user.includes("FAIL")) return new Reply(500, { error: "boom" });
  return {
    id: "stub", model: "stub",
    choices: [{ message: { content: JSON.stringify({ title: `抽签音乐会 ${T}`, eventAt: "2026-10-20 19:00", location: "焦廷标馆", audience: "全校师生", fee: "免费", signup: "https://example.com/signup", body: "正文草稿。" }) } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
});
for (const env of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[env] = `${provider.url}/v1`;
for (const env of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[env] = "test-key";

let orgId: number;
let ownerToken: string;

before(async () => {
  const org = await createOrganization({ name: `测试社团-${T}`, intro: "测试", contact: "x@example.com" }, "test");
  orgId = org.id;
  ownerToken = org.ownerToken;
});
after(async () => {
  // 自己的数据自己清：组织条目经 upsertMaterial 进入 articles，留在 'new' 状态会被告警测试算进去。
  const [o] = await sql<{ source_id: string }[]>`SELECT source_id FROM organizations WHERE id = ${orgId}`;
  if (o) {
    // org_posts 引用 articles（不级联）：先删组织（连带 org_posts），再删文章。
    await sql`DELETE FROM organizations WHERE id = ${orgId}`;
    await sql`DELETE FROM articles WHERE source_id = ${o.source_id}`;
    await sql`DELETE FROM sources WHERE id = ${o.source_id}`;
  }
  await provider.close();
  await app.close();
  await stopBoss();
  await closeDb();
});

const principal = async () => (await orgLogin(ownerToken, "test"))!.principal;

test("创建组织：同名 external 信源（first_party、T1_5、不采集）与 owner 令牌", async () => {
  const [o] = await sql<{ source_id: string; verified: boolean }[]>`SELECT source_id, verified FROM organizations WHERE id = ${orgId}`;
  assert.equal(o!.verified, false);
  const [s] = await sql<{ kind: string; first_party: boolean; tier: string; enabled: boolean }[]>`SELECT kind, first_party, tier, enabled FROM sources WHERE id = ${o!.source_id}`;
  assert.deepEqual(s, { kind: "external", first_party: true, tier: "T1_5", enabled: false });
  const login = await orgLogin(ownerToken, "test");
  assert.equal(login!.principal.role, "owner");
  assert.equal(await orgLogin("suo_wrong-token", "test"), null);
});

test("换届移交：新 owner 上位，旧 owner 降为 editor", async () => {
  const m = await addOrgMember(orgId, { name: "新负责人", role: "owner" }, "test");
  assert.equal(m.role, "owner");
  const roles = await sql<{ role: string }[]>`SELECT role FROM org_members WHERE org_id = ${orgId} ORDER BY id`;
  assert.deepEqual(roles.map((r) => r.role), ["editor", "owner"]);
});

test("投稿状态机：未核验拒投 → 核验 → pending → 批准进内容库", async () => {
  const p = await principal();
  await assert.rejects(createPost(p, { title: "未核验活动", body: "正文" }), (e: unknown) => e instanceof OrgError && e.status === 403);
  await setOrgVerified(orgId, true, "test");

  const { id } = await createPost(p, { title: `秋季迎新音乐会 ${T}`, body: "正文介绍。", eventAt: "2026-10-20 19:00", location: "焦廷标馆" });
  // 待审核可直接改
  await updatePost(p, id, { title: `秋季迎新音乐会（改） ${T}`, body: "正文介绍 v2。", eventAt: "2026-10-21 19:00" });
  const [pending] = await sql<{ title: string; status: string }[]>`SELECT title, status FROM org_posts WHERE id = ${id}`;
  assert.equal(pending!.status, "pending");
  assert.ok(pending!.title.includes("（改）"));

  const { articleId } = await approveOrgPost(id, "test");
  const [a] = await sql<{ title: string; source_id: string }[]>`SELECT a.title, a.source_id FROM articles a WHERE a.id = ${articleId}`;
  assert.ok(a!.title.includes("（改）"), "批准后用的是最新表单");
  const [src] = await sql<{ source_id: string }[]>`SELECT source_id FROM organizations WHERE id = ${orgId}`;
  assert.equal(a!.source_id, src!.source_id, "内容挂在组织的信源上");

  // 分析（这里是规则占位）之后就是普通公开条目
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected, campus)
            VALUES (${articleId}, 1, 'rule', 'pass', 'club', ${[`社团活动`]}::text[], ${`秋季迎新音乐会（改） ${T}`}, '摘要', '理由', 80, true,
            ${sql.json({ valueTier: "opportunity", identities: ["本科生", "硕士生"], deadline: "2026-10-20" } as never)})`;
  await publishArticle(articleId, { releasedAt: new Date() });
  const [pub] = await sql<{ campus: Record<string, unknown> }[]>`SELECT campus FROM publications WHERE article_id = ${articleId}`;
  assert.equal(pub!.campus.valueTier, "opportunity");
  const res = await app.inject({ method: "GET", url: `/api/site/items/${articleId}` });
  assert.equal(res.statusCode, 200, "公开条目可读");

  // 已发布不能直接改，只能提交变更申请
  await assert.rejects(updatePost(p, id, { title: "x", body: "y" }), (e: unknown) => e instanceof OrgError && e.status === 409);
  await requestChange(p, id, { type: "reschedule", patch: { title: `秋季迎新音乐会（改） ${T}`, body: "正文介绍 v2。", eventAt: "2026-10-25 19:00" }, reason: "场地冲突" });
  await assert.rejects(requestChange(p, id, { type: "cancel" }), (e: unknown) => e instanceof OrgError && e.status === 409, "同一时间只有一条变更申请");
  await resolveOrgPostChange(id, true, "", "test");
  const [moved] = await sql<{ event_at: Date; pending_change: unknown }[]>`SELECT event_at, pending_change FROM org_posts WHERE id = ${id}`;
  assert.equal(moved!.pending_change, null);
  assert.ok(moved!.event_at.toISOString().startsWith("2026-10-25"), "改期落回原条目");
  const [art] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${articleId}`;
  assert.ok(art!.revision >= 2, "原文出新版本，重走分析");

  // 取消：批准后公开条目下架
  await requestChange(p, id, { type: "cancel", reason: "因故取消" });
  await resolveOrgPostChange(id, true, "", "test");
  assert.equal((await app.inject({ method: "GET", url: `/api/site/items/${articleId}` })).statusCode, 404, "取消后条目下架");
});

test("驳回要填理由；队列能列出待办", async () => {
  const p = await principal();
  const { id } = await createPost(p, { title: `不合规活动 ${T}`, body: "正文" });
  await assert.rejects(rejectOrgPost(id, "  ", "test"));
  await rejectOrgPost(id, "信息不全", "test");
  const [row] = await sql<{ status: string; review_note: string }[]>`SELECT status, review_note FROM org_posts WHERE id = ${id}`;
  assert.deepEqual([row!.status, row!.review_note], ["rejected", "信息不全"]);
  const queue = await listOrgPosts({});
  assert.ok(!queue.some((q) => q.id === id), "已驳回不在待办队列");
});

test("权限隔离：组织会话在 /api/admin/* 是 403，组织接口要 CSRF", async () => {
  const login = await app.inject({ method: "POST", url: "/api/org/login", payload: { token: ownerToken } });
  assert.equal(login.statusCode, 303);
  const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
  assert.ok(cookie.startsWith(`${ORG_SESSION_COOKIE}=`));

  const me = await app.inject({ method: "GET", url: "/api/org/me", headers: { cookie } });
  assert.equal(me.statusCode, 200);
  const csrf = (me.json() as { csrf: string }).csrf;

  const asAdmin = await app.inject({ method: "GET", url: "/api/admin/orgs", headers: { cookie } });
  assert.equal(asAdmin.statusCode, 403, "组织令牌拿不到后台");
  assert.equal((await app.inject({ method: "GET", url: "/api/admin/orgs" })).statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/org/posts" })).statusCode, 401, "组织接口要登录");
  const noCsrf = await app.inject({ method: "POST", url: "/api/org/posts", headers: { cookie }, payload: { title: "x", body: "y" } });
  assert.equal(noCsrf.statusCode, 403, "写操作要 CSRF token");
  const withCsrf = await app.inject({ method: "POST", url: "/api/org/posts", headers: { cookie, "x-csrf-token": csrf }, payload: { title: `CSRF 测试 ${T}`, body: "正文" } });
  assert.equal(withCsrf.statusCode, 200);
});

test("AI 辅助：stub 出草稿；模型关闭时降级 unavailable 而不报错", async () => {
  const p = await principal();
  const res = await draftOrgPost(p, { text: `秋季迎新音乐会 ${T}，10月20日晚七点焦廷标馆，免费，全校师生。` });
  assert.equal(res.kind, "ok");
  if (res.kind === "ok") {
    assert.equal(res.draft.title, `抽签音乐会 ${T}`);
    assert.equal(res.draft.eventAt, "2026-10-20 19:00");
  }
  config.modelCallsEnabled = false;
  try {
    const off = await draftOrgPost(p, { text: "任意文字" });
    assert.deepEqual(off, { kind: "unavailable", reason: "off" });
  } finally {
    config.modelCallsEnabled = true;
  }
});
