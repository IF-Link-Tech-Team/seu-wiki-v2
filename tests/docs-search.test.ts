// 统一搜索：手册/经验进搜索（类型标记、章节锚点定位、按相关度而非时间排），类型筛选，
// 动态与长文混合返回。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadPool } from "@aihot/backend/publication/pool";
import { searchDocs } from "@aihot/backend/publication/search";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-docsearch-${T}`;
const app = await buildApp();

const doc = (slug: string, kind: "survival" | "experience", title: string, headings: unknown, searchText: string, occurredAt: string | null = null) =>
  sql`INSERT INTO docs (slug, kind, title, html, headings, occurred_at, content_hash, search_text)
      VALUES (${slug}, ${kind}, ${title}, '<p>正文</p>', ${sql.json(headings as never)}, ${occurredAt}, ${T}, ${searchText.toLowerCase()})`;

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES (${SOURCE}, 'Test docsearch', 'rss', 'T1', 'editorial', '2100-01-01')`;
  // 一篇手册：标题不含检索词，正文和小节标题含；锚点应指向最匹配的小节。
  await doc(`survival/测试篇/指南-${T}`, "survival", `指南 ${T}`, [
    { id: "准备", text: "准备", depth: 2 },
    { id: "保研流程", text: "保研流程", depth: 3 },
  ], `指南 ${T} 准备 保研流程 这是正文，里面有检索目标词的详细说明。`);
  // 一篇经验：发生年份保留。
  await doc(`experience/x/经历-${T}`, "experience", `经历 ${T}`, [], `经历 ${T} 检索目标词的经验正文`, "2021-08");
  // 一条动态（走正常投影，进 pool_search）。
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${T}`, title: `动态 ${T}`, bodyText: "", bodyHtml: null, bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected)
            VALUES (${articleId}, 1, 'rule', 'pass', 'club', '{}', ${`检索目标词宣讲会 ${T}`}, ${`摘要 ${T}`}, '理由', 80, true)`;
  await publishArticle(articleId, { releasedAt: new Date() });
});
after(async () => {
  await sql`DELETE FROM docs WHERE content_hash = ${T}`;
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await app.close();
  await stopBoss();
  await closeDb();
});

test("手册命中定位到最匹配的章节锚点；经验保留年份", async () => {
  const hits = await searchDocs(`检索目标词 ${T}`, null);
  const guide = hits.find((h) => h.kind === "survival")!;
  assert.ok(guide, "手册命中");
  const exp = hits.find((h) => h.kind === "experience")!;
  assert.equal(exp.occurredAt, "2021-08", "经验保留发生年份");
  // 检索词在正文与小节标题里都有：加一个出现在小节标题的词，锚点应指向它。
  const anchored = await searchDocs(`保研 ${T}`, null);
  const g2 = anchored.find((h) => h.kind === "survival")!;
  assert.equal(g2.anchor?.id, "保研流程");
});

test("类型筛选：feed 只出动态，survival/experience 只出长文", async () => {
  const all = await loadPool({ channel: "all", category: null, tag: null, q: `检索目标词 ${T}` });
  assert.ok(all.docs.length >= 1 && all.items.length === 1, "默认两边都命中");
  const feed = await loadPool({ channel: "all", category: null, tag: null, q: `检索目标词 ${T}`, type: "feed" });
  assert.deepEqual(feed.docs, []);
  assert.equal(feed.items.length, 1);
  const survival = await loadPool({ channel: "all", category: null, tag: null, q: `检索目标词 ${T}`, type: "survival" });
  assert.equal(survival.items.length, 0);
  assert.deepEqual(survival.docs.map((d) => d.kind), ["survival"]);
  const exp = await loadPool({ channel: "all", category: null, tag: null, q: `检索目标词 ${T}`, type: "experience" });
  assert.deepEqual(exp.docs.map((d) => d.kind), ["experience"]);
});

test("API：/api/site/pool 带 type 参数，响应带 docs", async () => {
  const res = await app.inject({ method: "GET", url: `/api/site/pool?q=${encodeURIComponent(`保研 ${T}`)}` });
  assert.equal(res.statusCode, 200);
  const body = res.json() as { docs: Array<{ kind: string; anchor: { id: string } | null }>; filters: { type: string } };
  assert.equal(body.filters.type, "all");
  assert.ok(body.docs.some((d) => d.kind === "survival" && d.anchor?.id === "保研流程"));
  const typed = await app.inject({ method: "GET", url: `/api/site/pool?q=${encodeURIComponent(`保研 ${T}`)}&type=survival` });
  const t2 = typed.json() as { items: unknown[]; docs: unknown[] };
  assert.equal(t2.items.length, 0);
  assert.ok(t2.docs.length >= 1);
});
