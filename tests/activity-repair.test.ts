import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { publishArticle } from "@aihot/backend/publication/publish";

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const source = `repair-activity-${tag()}`;
const oldEditorial = { kind: "activity_notice", evidence: "讲座预告", decision: "review", activities: [] };
after(async () => { await stopBoss(); await closeDb(); });

async function script(...args: string[]) {
  const { stdout } = await run(process.execPath, ["scripts/repair-activity-times.ts", ...args], {
    cwd: root, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, MODEL_CALLS_ENABLED: "false", COLLECT_ENABLED: "false", FEISHU_CONTENT_PUSH_ENABLED: "false", INDEXNOW_SUBMIT_ENABLED: "false" },
  });
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  return { summary: lines.at(-1), lines };
}

async function fixture(suffix: string, mismatchedReceipt = false) {
  const { articleId } = await upsertMaterial({ sourceId: source, url: `https://example.invalid/${source}/${suffix}`,
    title: `研究生讲座预告 ${suffix}`, bodyText: "讲座预告：2026年11月25日 周三18:30。", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  const raw = { kind: "activity_notice", evidence: "讲座预告", needsReview: false,
    activities: [{ name: "研究生人文与科学素养（专题）讲座", activityStart: "2026年11月25日 周三18:30" }] };
  const [receipt] = await sql<{ id: number }[]>`INSERT INTO receipts (logical_key,service,purpose,subject,status,response)
    VALUES (${`${source}-${suffix}`}, 'test', 'structure_article', ${`article:${articleId}@${mismatchedReceipt ? 0 : 1}`}, 'completed',
      ${sql.json({ choices: [{ message: { content: JSON.stringify({ editorial: raw }) } }] })}) RETURNING id`;
  const [analysis] = await sql<{ id: number }[]>`INSERT INTO analyses (article_id,input_revision,origin,receipt_ids,relevance,title_zh,selected,output)
    VALUES (${articleId},1,'rule',${[receipt!.id]},'pass',${`研究生讲座预告 ${suffix}`},true,${sql.json({ editorial: oldEditorial })}) RETURNING id`;
  await publishArticle(articleId, { releasedAt: new Date(Date.now() - 60_000) });
  return { id: articleId, analysisId: analysis!.id };
}

async function state(id: string) {
  const [row] = await sql<{ analysis_id: number; count: number }[]>`SELECT p.analysis_id,
    (SELECT count(*)::int FROM analyses an WHERE an.article_id=p.article_id) AS count FROM publications p WHERE p.article_id=${id}`;
  return row!;
}

test("实际修复脚本默认只读、追加回放且幂等，过期正文和不匹配回执不能应用", async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
    VALUES (${source},'活动回放脚本测试','rss','T1','editorial','2100-01-01')`;
  const current = await fixture("current");
  const stale = await fixture("stale");
  const badReceipt = await fixture("mismatched-receipt", true);
  await sql`UPDATE articles SET revision=2 WHERE id=${stale.id}`;
  const before = await state(current.id);
  const dry = await script();
  assert.equal(dry.summary.mode, "dry-run");
  assert.ok(dry.lines.some((line) => line.id === current.id), "可恢复的真实原始回执在dryrun中可见");
  assert.deepEqual(await state(current.id), before, "默认执行不写analysis或publication");

  const applied = await script("--apply");
  assert.equal(applied.summary.mode, "apply");
  const fixed = await state(current.id);
  assert.notEqual(fixed.analysis_id, current.analysisId);
  assert.equal(fixed.count, before.count + 1);
  const [replay] = await sql<{ origin: string; output: { editorial: { activities: { activityStart: { value: string } }[] } } }[]>`SELECT origin,output FROM analyses WHERE id=${fixed.analysis_id}`;
  assert.equal(replay!.origin, "replay");
  assert.equal(replay!.output.editorial.activities[0]?.activityStart.value, "2026-11-25T18:30+08:00");
  const [original] = await sql<{ output: { editorial: unknown } }[]>`SELECT output FROM analyses WHERE id=${current.analysisId}`;
  assert.deepEqual(original!.output.editorial, oldEditorial, "旧分析和原始回执保留，未覆盖历史");
  await script("--apply");
  assert.deepEqual(await state(current.id), fixed, "重复执行不再追加同样的分析");
  assert.deepEqual(await state(stale.id), { analysis_id: stale.analysisId, count: 1 }, "原文版本变化后不可回放旧结果");
  assert.deepEqual(await state(badReceipt.id), { analysis_id: badReceipt.analysisId, count: 1 }, "回执subject不是当前文章版本时不可应用");
});
