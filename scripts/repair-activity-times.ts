// Replay stored structure responses through the current evidence checks. No model or fetch calls.
// Dry-run by default; --apply appends a corrected analysis and republishes under version locks.
import { sql, closeDb } from "@aihot/backend/db";
import { loadAnalyzeInput } from "@aihot/backend/editorial/input";
import { ActivityEditorialSchema, normalizeActivityEditorial } from "@aihot/backend/editorial/activity";
import { projectActivitySchedule } from "@aihot/backend/publication/activity";
import { publishArticleTx } from "@aihot/backend/publication/publish";
import { stableJson } from "@aihot/backend/lib/ids";
import { stopBoss } from "@aihot/backend/jobs/queue";

const apply = process.argv.includes("--apply");
const rows = await sql<{ id: string; analysis_id: number; revision: number; output: Record<string, unknown>; title: string }[]>`
  SELECT p.article_id AS id, p.analysis_id, a.revision, an.output, p.title
  FROM publications p JOIN articles a ON a.id=p.article_id JOIN analyses an ON an.id=p.analysis_id
  WHERE p.visibility='public' AND p.selected AND p.visible_after<=now() AND an.input_revision=a.revision
    AND p.timeline_at >= now() - interval '30 days'
    AND an.output->'editorial'->>'kind' IN ('activity_notice','activity_registration','activity_update')
  ORDER BY p.timeline_at DESC LIMIT 200`;
let changed = 0;
let repaired = 0;
for (const row of rows) {
  const receipts = await sql<{ response: { choices?: { message?: { content?: string } }[] } }[]>`
    SELECT r.response FROM analyses an JOIN receipts r ON r.id=ANY(an.receipt_ids) WHERE an.id=${row.analysis_id}
      AND r.purpose='structure_article' AND r.subject=${`article:${row.id}@${row.revision}`}
      AND r.status IN ('received','completed') ORDER BY r.id DESC LIMIT 1`;
  let raw: unknown;
  for (const receipt of receipts) {
    try {
      const parsed = JSON.parse(receipt.response?.choices?.[0]?.message?.content ?? "{}");
      if (parsed.editorial) raw = parsed.editorial;
    } catch { /* Unusable stored answers are left unchanged. */ }
  }
  if (!raw) continue;
  const input = await loadAnalyzeInput(row.id);
  if (!input || input.revision !== row.revision) continue;
  const next = normalizeActivityEditorial(ActivityEditorialSchema.parse(raw), input);
  if (stableJson(projectActivitySchedule(next)) === stableJson(projectActivitySchedule(row.output.editorial))) continue;
  changed++;
  console.log(JSON.stringify({ id: row.id, title: row.title, before: projectActivitySchedule(row.output.editorial), after: projectActivitySchedule(next) }));
  if (!apply) continue;
  const didRepair = await sql.begin(async tx => {
    const [article] = await tx<{ revision: number }[]>`SELECT revision FROM articles WHERE id=${row.id} FOR UPDATE`;
    const [publication] = await tx<{ analysis_id: number }[]>`SELECT analysis_id FROM publications WHERE article_id=${row.id} FOR UPDATE`;
    const [latest] = await tx<{ id: number }[]>`SELECT id FROM analyses WHERE article_id=${row.id} ORDER BY input_revision DESC,id DESC LIMIT 1`;
    if (article?.revision !== row.revision || publication?.analysis_id !== row.analysis_id || latest?.id !== row.analysis_id) return false;
    await tx`INSERT INTO analyses (article_id,input_revision,origin,model,prompt_version,receipt_ids,relevance,category,tags,subjects,title_zh,summary_zh,reason_zh,score,selected,output,campus)
      SELECT article_id,input_revision,'replay',model,prompt_version,receipt_ids,relevance,category,tags,subjects,title_zh,summary_zh,reason_zh,score,selected,
        ${tx.json({ ...row.output, editorial: next } as never)},campus FROM analyses WHERE id=${row.analysis_id}`;
    await publishArticleTx(tx,row.id);
    return true;
  });
  if (didRepair) repaired++;
}
console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", scanned: rows.length, changed, repaired }));
await stopBoss();
await closeDb();
