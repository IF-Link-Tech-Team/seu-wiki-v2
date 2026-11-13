import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseManifest, recoverProgress, runBatch, saveCheckpoint, pool } from "../scripts/collect-source-batch.ts";
import { renameSync } from "node:fs";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { adaptIntervals } from "@aihot/backend/sources/collect";
import { upsertMaterial } from "@aihot/backend/content/materials";

const T = tag();
const dir = mkdtempSync(join(tmpdir(), "source-batch-"));
const server = await stub(() => ({ items: [{ title: "新通知一", url: `https://example.com/${T}/one` }, { title: "新通知二", url: `https://example.com/${T}/two` }] }));
config.allowPrivateNetworkFetch = true;
process.env.COLLECT_ENABLED = "false";
const base = { name: "测试信源", kind: "json_list", config: { url: server.url, itemsPath: "items", titlePaths: ["title"], urlTemplate: "{raw:url}" },
  tier: "T1", participation_mode: "editorial", tags: [], site_fulltext: false, enabled: false };
after(async () => { await server.close(); await stopBoss(); await closeDb(); rmSync(dir, { recursive: true }); });

test("checkpoint retries transient Windows replacement locks and preserves the previous file on permanent failure", () => {
  const file = join(dir, "checkpoint.json");
  writeFileSync(file, '{"old":true}');
  let attempts = 0;
  saveCheckpoint(file, { fresh: true }, (from, to) => {
    if (++attempts < 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
    renameSync(from, to);
  });
  assert.equal(attempts, 3);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { fresh: true });
  attempts = 0;
  assert.throws(() => saveCheckpoint(file, { lost: true }, () => {
    attempts++; throw Object.assign(new Error("still locked"), { code: "EPERM" });
  }), /still locked/);
  assert.equal(attempts, 6);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { fresh: true });
  assert.deepEqual(JSON.parse(readFileSync(`${file}.tmp`, "utf8")), { lost: true });
  attempts = 0;
  assert.throws(() => saveCheckpoint(file, {}, () => {
    attempts++; throw Object.assign(new Error("disk failure"), { code: "EIO" });
  }), /disk failure/);
  assert.equal(attempts, 1);
});

test("a failed batch stops dispatching and waits for work already in flight", async () => {
  let finished = false;
  const seen: number[] = [];
  await assert.rejects(pool([1, 2, 3], 2, async (n) => {
    seen.push(n);
    if (n === 1) throw new Error("checkpoint failed");
    await new Promise((done) => setTimeout(done, 20));
    finished = true;
  }), /checkpoint failed/);
  assert.equal(finished, true);
  assert.deepEqual(seen, [1, 2]);
});

test("explicit manifests ignore evidence but reject duplicate ids or unsupported source config", () => {
  const parsed = parseManifest({ entries: [{ ...base, id: "one", evidence: "verified" }] });
  assert.equal("evidence" in parsed[0], false);
  assert.equal(parsed[0].interval_minutes, 60);
  assert.equal(parseManifest([{ ...base, id: "mp", interval_minutes: 1440 }])[0].interval_minutes, 1440);
  assert.throws(() => parseManifest([{ ...base, id: "one" }, { ...base, id: "one" }]), /duplicate/);
  assert.throws(() => parseManifest([{ ...base, id: "one", config: { notSupported: true } }]), /不支持/);
});

test("daily adaptation leaves an administrator's once-daily WeChat interval unchanged", async () => {
  const id = `batch-daily-mp-${T}`;
  await sql`INSERT INTO sources (id, name, kind, config, enabled, interval_minutes)
    VALUES (${id}, '每日公众号', 'mp_account', '{}', true, 1440)`;
  await adaptIntervals();
  const [saved] = await sql<{ interval_minutes: number }[]>`SELECT interval_minutes FROM sources WHERE id = ${id}`;
  assert.equal(saved!.interval_minutes, 1440);
});

test("interrupted paid work is marked unknown rather than queued for automatic retry", () => {
  const p = { fingerprint: "x", startedAt: "x", attemptStart: 0,
    sources: { one: { register: { status: "ok" as const }, collect: { status: "running" as const }, articles: [] } },
    articles: { a: { sourceId: "one", process: { status: "running" as const } } } };
  recoverProgress(p);
  assert.equal(p.sources.one.collect.status, "unknown");
  assert.equal(p.articles.a.process.status, "unknown");
});

test("batch inserts only explicit sources, preserves existing configuration, caps collection and resumes without refetch", async () => {
  const existing = `batch-existing-${T}`, fresh = `batch-fresh-${T}`;
  await sql`INSERT INTO sources (id, name, kind, config, enabled) VALUES (${existing}, '原始名称', 'json_list',
    ${sql.json(base.config)}, true)`;
  const manifest = join(dir, "manifest.json"), state = join(dir, "progress.json");
  writeFileSync(manifest, JSON.stringify({ entries: [{ ...base, id: existing }, { ...base, id: fresh },
    { ...base, id: `batch-broken-${T}`, config: { ...base.config, url: "http://[invalid" } }] }));
  const opts = { manifest, state, limitPerSource: 1, concurrency: 2 };
  await runBatch({ ...opts, phase: "register" });
  const [saved] = await sql<{ name: string; enabled: boolean; config: object }[]>`SELECT name, enabled, config FROM sources WHERE id = ${existing}`;
  assert.equal(saved!.name, "原始名称"); assert.equal(saved!.enabled, true); assert.deepEqual(saved!.config, base.config);
  const report = await runBatch({ ...opts, phase: "collect" });
  assert.equal(report.collected_ok, 2);
  assert.equal(report.failed, 1, "a single source failure does not stop the other sources");
  assert.equal(server.hits(), 2);
  const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id IN (${existing}, ${fresh})`;
  // The same two source listings discover one common article; no second item is admitted by the per-run cap.
  assert.equal(count!.n, 1);
  await runBatch({ ...opts, phase: "collect" }); assert.equal(server.hits(), 2);
  const pending = await runBatch({ ...opts, phase: "process", maxArticles: 0 });
  assert.ok(pending.articles_pending > 0);
  assert.equal(JSON.parse(readFileSync(state, "utf8")).sources[fresh].collect.status, "ok");
});

test("batch recovery completes unfinished grouping of analyzed reports without running analysis again", async (t) => {
  const sourceId = `batch-recover-${T}`, manifest = join(dir, "recover-manifest.json"), state = join(dir, "recover-state.json");
  t.after(async () => {
    // Do not leave synthetic reports in the recall window for subsequent tests/runs.
    await sql`DELETE FROM articles WHERE source_id = ${sourceId}`;
    await sql`DELETE FROM sources WHERE id = ${sourceId}`;
  });
  writeFileSync(manifest, JSON.stringify([{ ...base, id: sourceId }]));
  await runBatch({ manifest, state, phase: "register" });
  const progress = JSON.parse(readFileSync(state, "utf8"));
  const ids: string[] = [];
  for (const [index, status] of ["unfinished", "group-failed", "complete", "blocked"].entries()) {
    // UUIDs can share enough character bigrams to recall each other and trigger an unconfigured
    // model. Distinct private-use characters keep these recovery fixtures lexically unrelated,
    // including to the ordinary text left by other tests in the shared database.
    const title = String.fromCodePoint(0xe000 + index).repeat(8);
    const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${T}/${status}`, title,
      bodyText: title, bodyStatus: "ok", publishedAt: new Date(), via: "fetch" });
    ids.push(articleId);
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, title_zh, summary_zh, score, selected, output)
      VALUES (${articleId}, 1, 'rule', ${status === "blocked" ? "block" : "pass"}, 'academic', ${title}, ${title}, 80, false, '{}')`;
    await sql`UPDATE articles SET processing_state = ${status === "blocked" ? "blocked" : "analyzed"},
      grouped_at = ${["group-failed", "complete"].includes(status) ? new Date() : null} WHERE id = ${articleId}`;
    progress.articles[articleId] = { sourceId, process: { status: "pending" }, stage: status === "complete" ? "done" : "group" };
  }
  writeFileSync(state, JSON.stringify(progress));
  const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM receipt_attempts`;
  process.env.EMBEDDINGS_ENABLED = "false";
  try {
    const report = await runBatch({ manifest, state, phase: "process", allowModelCalls: true, maxArticles: 4, concurrency: 3 });
    const saved = JSON.parse(readFileSync(state, "utf8"));
    assert.equal(report.articles_processed, 4, JSON.stringify(saved.articles));
    assert.equal(report.articles_failed, 0);
    const links = await sql<{ article_id: string }[]>`SELECT article_id FROM fact_articles WHERE article_id IN ${sql(ids)} ORDER BY article_id`;
    assert.deepEqual(links.map((r) => r.article_id).sort(), ids.slice(0, 2).sort(), "both missing and previously failed grouping resume; completed and blocked reports stay unchanged");
    const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM receipt_attempts`;
    assert.equal(after!.n, before!.n, "these unrelated reports group without any new analysis or paid calls");
    const [analyses] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM analyses WHERE article_id IN ${sql(ids)}`;
    assert.equal(analyses!.n, 4);
    for (const id of ids.slice(0, 2)) assert.equal(saved.articles[id].stage, "done");
  } finally { delete process.env.EMBEDDINGS_ENABLED; }
});
