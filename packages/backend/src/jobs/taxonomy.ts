// 词表回填：新词批准或别名建立后，把近 90 天且在有效期内（campus.deadline 未过期）的内容里
// 正文含该词（或别名）的条目先关键词粗筛出来，再调模型逐个确认（回执与预算熔断照常），确认的
// 补标签（analyses 最新行 + publications）。
// MODEL_CALLS_ENABLED 关闭时任务只记录粗筛命中数、不做模型调用（词表审核不受影响，下轮开阀后
// 在后台重新点一次批准/别名即可再排）。
import { z } from "zod";
import type { PgBoss } from "pg-boss";
import { config } from "../config.ts";
import { sql } from "../db.ts";
import { chatJson } from "../providers/llm.ts";
import { modelFor } from "../editorial/models.ts";
import { promptText, promptVersion } from "../editorial/prompts.ts";
import { ensureQueue, QUEUES } from "./queue.ts";

const ConfirmSchema = z.object({ onTopic: z.boolean().catch(false) });

const CONFIRM_SYSTEM = promptText("topic-confirm");
const CONFIRM_VERSION = promptVersion("topic-confirm");

/** 粗筛：近 90 天、有效期内、检索文本含词/别名之一的公开条目（上限 200 条封顶费用）。 */
async function coarseCandidates(term: string, aliases: string[]) {
  const words = [term, ...aliases];
  const like = words.reduce((acc, w) => sql`${acc} OR p.search_text LIKE ${"%" + w.toLowerCase() + "%"}`, sql`FALSE`);
  return sql<{ article_id: string; title: string; summary: string | null }[]>`
    SELECT p.article_id, p.title, p.summary FROM publications p
    WHERE p.visibility = 'public' AND p.timeline_at > now() - interval '90 days'
      AND (p.campus->>'deadline' IS NULL OR p.campus->>'deadline' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' OR (p.campus->>'deadline')::date >= now()::date)
      AND (${like})
    ORDER BY p.timeline_at DESC LIMIT 200`;
}

export async function backfillTerm(payload: { termId: number; term: string; aliases: string[] }): Promise<{ scanned: number; tagged: number; skipped: boolean }> {
  const rows = await coarseCandidates(payload.term, payload.aliases);
  if (!config.modelCallsEnabled) {
    console.log(JSON.stringify({ level: "info", msg: "taxonomy backfill recorded only (MODEL_CALLS_ENABLED=false)", term: payload.term, scanned: rows.length }));
    return { scanned: rows.length, tagged: 0, skipped: true };
  }
  const model = await modelFor("prefilter"); // 确认用最便宜的工位模型
  let tagged = 0;
  for (const row of rows) {
    const res = await chatJson({
      model,
      purpose: "taxonomy_backfill",
      subject: `article:${row.article_id}`,
      promptVersion: CONFIRM_VERSION,
      system: CONFIRM_SYSTEM,
      user: `【主题词】${payload.term}\n\n【标题】${row.title}\n\n【摘要】${row.summary ?? ""}`,
      schema: ConfirmSchema,
      temperature: 0,
      maxTokens: 128,
    });
    if (!res.data.onTopic) continue;
    await sql`UPDATE analyses SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ${[payload.term]}::text[]) t)
              WHERE article_id = ${row.article_id} AND id = (SELECT max(id) FROM analyses a2 WHERE a2.article_id = ${row.article_id})`;
    await sql`UPDATE publications SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ${[payload.term]}::text[]) t) WHERE article_id = ${row.article_id}`;
    tagged += 1;
  }
  return { scanned: rows.length, tagged, skipped: false };
}

export async function registerTaxonomyJobs(boss: PgBoss) {
  await ensureQueue(QUEUES.taxonomyBackfill);
  await boss.work<{ termId: number; term: string; aliases: string[] }>(QUEUES.taxonomyBackfill, { localConcurrency: 1, pollingIntervalSeconds: 2 }, async ([job]) => {
    if (!job) return;
    return backfillTerm(job.data);
  });
}
