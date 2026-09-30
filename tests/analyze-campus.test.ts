// The structure step's campus audience (industry/prompts/structure.md 第五步): the stub model's
// campus is enum-filtered into analyses.campus and projected to publications.campus; illegal values
// lose only their own field; no campus output leaves the column null; a short body whose page links
// an attachment gets completeness: attachment-missing by rule.
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle, normalizeCampus } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";
import { stopBoss } from "@aihot/backend/jobs/queue";

const T = tag();
const SOURCE = `test-campus-${T}`;

type Step = "prefilter" | "score" | "structure" | "understand";
// 未匹配到的是 understand（内容理解编辑）：让它落到默认分支，stub 永不抛错（抛错会让请求悬挂）。
const stepOf = (system: string): Step =>
  system.includes("宽召回的校园相关性预筛") ? "prefilter" : system.includes("事件注意力评分器") ? "score"
  : system.includes("资料结构化助手") ? "structure" : "understand";

const CAMPUSES: Record<string, unknown> = {
  OK: {
    identities: ["本科生", "硕士生"], colleges: ["信息学院", "不存在的学院"], grades: ["2024"],
    deadline: "2026-10-20", valueTier: "action", completeness: "full",
  },
  BAD: {
    identities: ["教授"], colleges: ["不存在的学院"], grades: ["去年"], deadline: "明年3月",
    valueTier: "must", completeness: "maybe",
  },
};

const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: unknown }> };
  const system = body.messages[0]!.role === "system" ? String(body.messages[0]!.content) : "";
  const last = body.messages[body.messages.length - 1]!.content;
  const user = typeof last === "string" ? last : JSON.stringify(last);
  const marker = user.match(/CAMPUS(OK|BAD|NONE|ATTACH)/)?.[1] ?? "";
  const answer = (content: unknown) => ({ id: "stub", model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  const step = stepOf(system);
  if (step === "prefilter") return answer({ label: "PASS", reason: "测试" });
  if (step === "score") return answer({ attentionScore: 80 });
  if (step === "structure") {
    return answer({
      category: "academic", tags: ["教务通知"], subjects: ["jwc"],
      fact: { title: "事实", subject: "教务处", action: "发布", object: "通知", occurredAt: null },
      ...(marker === "NONE" || marker === "ATTACH" ? {} : { campus: CAMPUSES[marker] }),
    });
  }
  return answer({ itemType: "notice", authorRole: "principal", tags: ["教务通知"], editorialJudgment: "理由", titleZh: `标题 ${marker}`, summaryZh: `摘要 ${marker}。` });
});
for (const env of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[env] = `${provider.url}/v1`;
for (const env of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[env] = "test-key";

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, site_fulltext, next_fetch_at)
            VALUES (${SOURCE}, 'Test campus source', 'rss', 'T1', 'editorial', true, '2100-01-01')`;
});
after(async () => {
  // 自己的数据自己清：留在 'new' 状态的文章会被告警测试（全局卡点统计）算进去。
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await provider.close();
  await stopBoss();
  await closeDb();
});

const article = (marker: string, extra: Record<string, unknown> = {}) =>
  upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/${marker}-${T}`, title: `CAMPUS${marker} 通知 ${T}`,
    bodyText: `CAMPUS${marker}：` + "这是一条用于测试的正文，包含足够的篇幅说明事项。".repeat(10),
    bodyStatus: "ok", via: "fetch", publishedAt: new Date("2026-09-28T01:02:03Z"), ...extra,
  } as never).then((r) => r.articleId);

const campusOfAnalysis = async (id: string) =>
  (await sql<{ campus: Record<string, unknown> | null }[]>`SELECT campus FROM analyses WHERE article_id = ${id} ORDER BY id DESC LIMIT 1`)[0]?.campus;
const campusOfPublication = async (id: string) =>
  (await sql<{ campus: Record<string, unknown> | null }[]>`SELECT campus FROM publications WHERE article_id = ${id}`)[0]?.campus;

test("structure 输出 campus：枚举过滤后落库 analyses.campus，并投影到 publications.campus", async () => {
  const id = await article("OK");
  const res = await analyzeArticle(id);
  assert.deepEqual(res!.output!.campus, {
    identities: ["本科生", "硕士生"], colleges: ["信息科学与工程学院"], grades: ["2024"],
    deadline: "2026-10-20", valueTier: "action", completeness: "full",
  }, "学院别名归一为全称，不认识的学院丢弃");
  assert.deepEqual(await campusOfAnalysis(id), res!.output!.campus);
  await publishArticle(id, { releasedAt: new Date() });
  assert.deepEqual(await campusOfPublication(id), res!.output!.campus, "投影拷贝 campus");
});

test("非法枚举值只丢自己的字段；全部被滤掉时 campus 为 null", async () => {
  const id = await article("BAD");
  const res = await analyzeArticle(id);
  assert.equal(res!.output!.campus, null);
  assert.equal(await campusOfAnalysis(id), null);
});

test("structure 不输出 campus 时列为 null", async () => {
  const id = await article("NONE");
  await analyzeArticle(id);
  assert.equal(await campusOfAnalysis(id), null);
  await publishArticle(id, { releasedAt: new Date() });
  assert.equal(await campusOfPublication(id), null);
});

test("规则兜底：正文短且原文页带附件链接 → completeness 标 attachment-missing", async () => {
  const id = await article("ATTACH", {
    bodyText: "CAMPUSATTACH：名单见附件。",
    bodyHtml: `<p>CAMPUSATTACH：名单见附件。</p><p><a href="https://example.com/files/list.xlsx">附件：名单.xlsx</a></p>`,
  });
  const res = await analyzeArticle(id);
  assert.deepEqual(res!.output!.campus, { completeness: "attachment-missing" });
});

test("normalizeCampus 边界：非法日期、全校优先、空对象", () => {
  assert.equal(normalizeCampus({ identities: [], colleges: [], grades: [], deadline: "2026-02-30", valueTier: null, completeness: null }), null);
  assert.deepEqual(normalizeCampus({ identities: [], colleges: ["全校", "信息学院"], grades: [], deadline: null, valueTier: null, completeness: null }), { colleges: ["全校"] });
  assert.equal(normalizeCampus(null), null);
  assert.deepEqual(
    normalizeCampus(null, { bodyText: "见附件。", hasAttachment: true } as never),
    { completeness: "attachment-missing" },
    "模型没给 campus 时规则兜底也能成立",
  );
});
