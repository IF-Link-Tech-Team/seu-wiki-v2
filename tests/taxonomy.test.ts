// 运行时兴趣词表：种子导入幂等；候选池三入口共用一个 recordCandidate（同词计数、≥3 进审核队列、
// active/别名/rejected 不再进）；批准选分组、设别名归一、拒绝留档；管理员手动加词直接 active。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { TOPIC_GROUPS } from "@aihot/industry/taxonomy";
import {
  addTerm, aliasTerm, approveTerm, CANDIDATE_THRESHOLD, canonicalTag, getTaxonomyTerms, listTaxonomy, recordCandidate, rejectTerm, seedTaxonomyTerms,
} from "@aihot/backend/taxonomy/terms";
import { backfillTerm } from "@aihot/backend/jobs/taxonomy";
import { config } from "@aihot/backend/config";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";

const T = tag();
const W = (s: string) => `${s}${T}`; // 词带上测试标记，避开种子词
const SOURCE = `test-taxonomy-${T}`;

before(async () => {
  await seedTaxonomyTerms();
});

after(async () => {
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await stopBoss();
  await closeDb();
});

test("种子导入：TOPIC_GROUPS 落为 active 词，幂等", async () => {
  const again = await seedTaxonomyTerms();
  assert.equal(again, 0, "第二次导入不应新增");
  const tax = await getTaxonomyTerms();
  for (const g of TOPIC_GROUPS) for (const name of g.terms) assert.ok(tax.active.includes(name), `缺种子词 ${name}`);
});

test("候选池：同词计数，满门槛才进审核队列", async () => {
  const name = W("嵌入式");
  await recordCandidate(name, "model", `/items/a-${T}`);
  let { candidates } = await listTaxonomy();
  assert.ok(!candidates.some((c) => c.name === name), "未满门槛不应出现");
  for (let i = 0; i < CANDIDATE_THRESHOLD - 1; i++) await recordCandidate(`#${name} `, "org", null); // 去 #、去空格后仍是同词
  ({ candidates } = await listTaxonomy());
  const c = candidates.find((x) => x.name === name);
  assert.ok(c, "满门槛应出现");
  assert.equal(c!.count, CANDIDATE_THRESHOLD);
  assert.ok(c!.examples.includes(`/items/a-${T}`));
});

test("候选池：active 词、别名、rejected 词不再进", async () => {
  const seed = TOPIC_GROUPS[0]!.terms[0]!;
  await recordCandidate(seed, "model");
  const [r1] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM taxonomy_terms WHERE name = ${seed}`;
  assert.equal(r1!.count, 1, "active 词只应有一行（种子行）");

  const rejected = W("一次性活动名");
  await sql`INSERT INTO taxonomy_terms (grp, name, status, source) VALUES ('', ${rejected}, 'rejected', 'model')`;
  await recordCandidate(rejected, "model");
  const [r2] = await sql<{ status: string; count: number }[]>`SELECT status, count FROM taxonomy_terms WHERE name = ${rejected}`;
  assert.deepEqual([r2!.status, r2!.count], ["rejected", 0]);
});

test("批准：选分组转 active 并排回填任务；别名归一", async () => {
  const name = W("大创项目");
  for (let i = 0; i < CANDIDATE_THRESHOLD; i++) await recordCandidate(name, "model");
  const { candidates } = await listTaxonomy();
  const c = candidates.find((x) => x.name === name)!;
  const grp = TOPIC_GROUPS[1]!.label;
  const t = await approveTerm(c.id, grp, "test");
  assert.equal(t.status, "active");
  assert.equal(t.grp, grp);
  const tax = await getTaxonomyTerms();
  assert.ok(tax.active.includes(name));

  // 候选变别名：另一个候选归到刚批准的词
  const alias = W("大创");
  for (let i = 0; i < CANDIDATE_THRESHOLD; i++) await recordCandidate(alias, "org");
  const { candidates: c2 } = await listTaxonomy();
  const a = c2.find((x) => x.name === alias)!;
  const res = await aliasTerm(a.id, name, "test");
  assert.equal(res.target, name);
  const tax2 = await getTaxonomyTerms();
  assert.equal(canonicalTag(alias, tax2), name, "别名应归一到主词");
  const { candidates: c3 } = await listTaxonomy();
  assert.ok(!c3.some((x) => x.name === alias), "已处理的候选不应再出现");
});

test("拒绝与手动加词", async () => {
  const name = W("花边词");
  for (let i = 0; i < CANDIDATE_THRESHOLD; i++) await recordCandidate(name, "model");
  const { candidates } = await listTaxonomy();
  const c = candidates.find((x) => x.name === name)!;
  await rejectTerm(c.id, "test");
  await recordCandidate(name, "model");
  const [r] = await sql<{ status: string }[]>`SELECT status FROM taxonomy_terms WHERE name = ${name}`;
  assert.equal(r!.status, "rejected", "拒绝后同词不再进候选池");

  const manual = W("量子信息");
  const t = await addTerm(manual, TOPIC_GROUPS[1]!.label, "test");
  assert.equal(t!.status, "active");
  const tax = await getTaxonomyTerms();
  assert.ok(tax.active.includes(manual));
  await assert.rejects(() => addTerm(manual, "不存在的分组", "test"), /未知的分组/);
});

test("回填粗筛：近 90 天且有效期内的条目按词/别名命中，关阀时只记录不调用模型", async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES (${SOURCE}, 'Test taxonomy', 'rss', 'T1', 'editorial', '2100-01-01')`;
  const word = W("碳中和");
  const alias = W("双碳");
  const future = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
  const mk = async (key: string, text: string, campus: Record<string, unknown> | null, daysAgo = 1) => {
    const { articleId } = await upsertMaterial({
      sourceId: SOURCE, url: `https://example.com/${T}-${key}`, title: key, bodyText: "", bodyHtml: null, bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
    });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected)
              VALUES (${articleId}, 1, 'rule', 'pass', 'news', ${[]}::text[], ${key}, ${`摘要-${key}`}, '理由', 60, true)`;
    await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
    await sql`UPDATE publications SET search_text = search_text || ${" " + text.toLowerCase()},
              timeline_at = now() - ${daysAgo + " days"}::interval, campus = ${sql.json((campus ?? {}) as never)} WHERE article_id = ${articleId}`;
  };
  await mk(`hit-${T}`, word, { deadline: future });            // 命中：在有效期内
  await mk(`expired-${T}`, word, { deadline: "2020-01-01" });  // 排除：deadline 已过
  await mk(`old-${T}`, word, null, 100);                       // 排除：超过 90 天
  await mk(`alias-${T}`, alias, null);                         // 命中：只含别名

  config.modelCallsEnabled = false;
  let res: Awaited<ReturnType<typeof backfillTerm>>;
  try {
    res = await backfillTerm({ termId: 0, term: word, aliases: [alias] });
  } finally {
    config.modelCallsEnabled = true;
  }
  assert.equal(res!.skipped, true, "MODEL_CALLS_ENABLED 关闭时应只记录");
  assert.equal(res!.scanned, 2, "应只命中有效期内和别名两条");
  assert.equal(res!.tagged, 0);
});
