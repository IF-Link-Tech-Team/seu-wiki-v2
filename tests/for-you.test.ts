// 「为你」信息流：匹配加成（学院命中、封顶 40、未知维度中性、「全校」不是全命中）和 API 的
// 画像参数解析。数据走真实投影：写入分析 → publishArticle → UPDATE campus（等价于 LLM 提取后投影拷贝）。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadForYou, parseForYouProfile } from "@aihot/backend/publication/foryou";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const SOURCE = `test-foryou-${T}`;
const app = await buildApp();

const futureDeadline = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

/** 一条公开、入池的条目；campus 由测试直接写在投影上。 */
async function item(title: string, score: number, tags: string[], campus: Record<string, unknown> | null): Promise<string> {
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${T}-${title}`, title, bodyText: "", bodyHtml: null, bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  });
  await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected)
            VALUES (${articleId}, 1, 'rule', 'pass', 'club', ${tags}, ${title}, ${`摘要-${title}`}, '理由', ${score}, true)`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  if (campus) await sql`UPDATE publications SET campus = ${sql.json(campus as never)} WHERE article_id = ${articleId}`;
  return articleId;
}

let A: string; // 信息学院 + 本科生 + 大三 + 保研 + entity:jwc，截止在未来，score 90
let B: string; // 全校（中性），score 95
let C: string; // 无 campus，score 99

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES (${SOURCE}, 'Test foryou', 'rss', 'T1', 'editorial', '2100-01-01')`;
  A = await item(`A-${T}`, 90, ["保研", "entity:jwc"], {
    colleges: ["信息科学与工程学院"], identities: ["本科生"], grades: ["大三"], deadline: futureDeadline, valueTier: "action",
  });
  B = await item(`B-${T}`, 95, [], { colleges: ["全校"] });
  C = await item(`C-${T}`, 99, [], null);
});
after(async () => {
  // 自己的数据自己清：留在 'new' 状态的文章会被告警测试（全局卡点统计）算进去。
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await app.close();
  await stopBoss();
  await closeDb();
});

const find = (res: Awaited<ReturnType<typeof loadForYou>>, id: string) => res.items.find((i) => i.id === id);

test("画像参数解析：逗号列表、未知学历中性、超长截断", () => {
  const p = parseForYouProfile({ college: " 信息科学与工程学院 ", degree: "本科", grade: "大三", interests: "保研, 实习,", orgs: "jwc" });
  assert.deepEqual(p, { college: "信息科学与工程学院", degree: "本科", grade: "大三", interests: ["保研", "实习"], orgs: ["jwc"] });
  assert.equal(parseForYouProfile({ degree: "高一" }).degree, null);
  assert.equal(parseForYouProfile({}).interests!.length, 0);
  assert.equal(parseForYouProfile({ interests: Array.from({ length: 20 }, (_, i) => `t${i}`).join(",") }).interests!.length, 10);
});

test("学院命中：+30 并给出理由，排序上浮", async () => {
  const anon = await loadForYou({ category: "club", profile: {} });
  assert.deepEqual(find(anon, A)!.matchReasons, []);
  assert.ok(find(anon, C)!.rankScore > find(anon, A)!.rankScore, "无画像时按基础分排");

  const res = await loadForYou({ category: "club", profile: { college: "信息科学与工程学院" } });
  const a = find(res, A)!;
  assert.ok(a.matchReasons.includes("信息科学与工程学院"));
  assert.equal(a.rankScore, 120, "基础分 90（截止期内不衰减）+ 学院 30");
  assert.equal(res.items[0]!.id, A, "命中卡片上浮到最前");
});

test("匹配加成封顶 40", async () => {
  const res = await loadForYou({ category: "club", profile: { college: "信息科学与工程学院", degree: "本科", grade: "大三", interests: ["保研"], orgs: ["jwc"] } });
  const a = find(res, A)!;
  assert.equal(a.rankScore, 130, "学院30+学历15+年级10+兴趣10+组织30 = 95，封顶 40 → 90+40");
  for (const reason of ["信息科学与工程学院", "本科生", "大三", "保研", "jwc"]) assert.ok(a.matchReasons.includes(reason), `理由含 ${reason}`);
});

test("未知维度中性：空画像零加成、零理由", async () => {
  const res = await loadForYou({ category: "club", profile: {} });
  for (const it of res.items) assert.deepEqual(it.matchReasons, []);
  assert.equal(find(res, C)!.rankScore, 99);
  assert.equal(find(res, B)!.rankScore, 95);
});

test("「全校」是中性：不加学院分", async () => {
  const res = await loadForYou({ category: "club", profile: { college: "信息科学与工程学院" } });
  const b = find(res, B)!;
  assert.deepEqual(b.matchReasons, []);
  assert.equal(b.rankScore, 95);
});

test("API：/api/site/for-you 解析画像参数且永不共享缓存", async () => {
  const res = await app.inject({ method: "GET", url: `/api/site/for-you?category=club&college=${encodeURIComponent("信息科学与工程学院")}&interests=保研&degree=肄业` });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["cache-control"], "private, no-store");
  const body = res.json() as { items: Array<{ id: string; matchReasons: string[]; rankScore: number }>; profile: { degree: string | null } };
  assert.equal(body.profile.degree, null, "未知学历被忽略");
  const a = body.items.find((i) => i.id === A)!;
  assert.ok(a.matchReasons.includes("信息科学与工程学院") && a.matchReasons.includes("保研"));
  assert.equal(body.items[0]!.id, A);

  const anon = (await app.inject({ method: "GET", url: "/api/site/for-you?category=club" })).json() as { items: Array<{ id: string }> };
  assert.notEqual(anon.items[0]!.id, A, "匿名请求排序不同");
});
