// Explicit, resumable manual batches. No scheduler or workers are started here.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { sql, closeDb } from "../packages/backend/src/db.ts";
import { config } from "../packages/backend/src/config.ts";
import { stopBoss, shutdownSignal } from "../packages/backend/src/jobs/queue.ts";
import { collectSource } from "../packages/backend/src/sources/collect.ts";
import { checkMpAccount } from "../packages/backend/src/sources/mp.ts";
import { assertSupportedConfig } from "../packages/backend/src/sources/config-keys.ts";
import { extractArticleBody } from "../packages/backend/src/content/extract.ts";
import { processArticle } from "../packages/backend/src/jobs/content.ts";
import { groupArticle } from "../packages/backend/src/events/group.ts";

const Entry = z.object({ id: z.string().min(1), name: z.string().min(1),
  kind: z.enum(["rss", "web_list", "json_list", "x_search", "mp_account", "external"]),
  config: z.record(z.string(), z.unknown()), tier: z.enum(["T1", "T1_5", "T2", "EXCLUDE_MP"]),
  participation_mode: z.enum(["editorial", "hot_signal", "isolated"]),
  tags: z.array(z.string()).default([]), site_fulltext: z.boolean().default(false), enabled: z.boolean().default(false),
  interval_minutes: z.number().int().min(1).max(1440).default(60),
});
export type ManifestEntry = z.infer<typeof Entry>;
export function parseManifest(value: unknown): ManifestEntry[] {
  const raw = Array.isArray(value) ? value : (value as { entries?: unknown; sources?: unknown })?.entries ?? (value as { sources?: unknown })?.sources;
  const entries = z.array(Entry).min(1).parse(raw);
  if (new Set(entries.map((e) => e.id)).size !== entries.length) throw new Error("manifest contains duplicate source ids");
  for (const e of entries) assertSupportedConfig(e.kind, e.config);
  return entries;
}
type Status = "pending" | "running" | "ok" | "failed" | "unknown" | "skipped";
interface Step { status: Status; error?: string; result?: unknown }
interface Progress {
  fingerprint: string; startedAt: string; attemptStart: number;
  sources: Record<string, { register: Step; collect: Step; articles: string[] }>;
  articles: Record<string, { sourceId: string; process: Step; stage?: string }>;
}
export interface BatchOptions {
  manifest: string; state: string; phase: "register" | "collect" | "process" | "report";
  limitPerSource?: number; maxArticles?: number; concurrency?: number; allowModelCalls?: boolean; signal?: AbortSignal;
}
export function recoverProgress(p: Progress): void {
  for (const source of Object.values(p.sources)) {
    if (source.register.status === "running") source.register.status = "pending"; // INSERT ON CONFLICT is safe to resume.
    if (source.collect.status === "running") Object.assign(source.collect, { status: "unknown", error: "interrupted; inspect before retrying" });
  }
  for (const a of Object.values(p.articles)) if (a.process.status === "running")
    Object.assign(a.process, { status: "unknown", error: "interrupted; no automatic paid retry" });
}
export function saveCheckpoint(path: string, value: unknown, replace: typeof renameSync = renameSync) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), "utf8");
  for (let attempt = 0; ; attempt++) {
    try { replace(temporary, path); return; }
    catch (error) {
      if (attempt >= 5 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      // Windows antivirus/indexers briefly hold replacement targets. Keep the old checkpoint intact.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * 2 ** attempt);
    }
  }
}
export async function pool<T>(items: T[], concurrency: number, action: (item: T) => Promise<void>, signal?: AbortSignal) {
  let index = 0, stopped = false;
  const workers = await Promise.allSettled(Array.from({ length: concurrency }, async () => {
    while (!stopped && !signal?.aborted) {
      const item = items[index++]; if (item === undefined) return;
      try { await action(item); } catch (error) { stopped = true; throw error; }
    }
  }));
  const failure = workers.find((r) => r.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}
export async function runBatch(options: BatchOptions) {
  const entries = parseManifest(JSON.parse(readFileSync(options.manifest, "utf8").replace(/^\uFEFF/, "")));
  const limit = options.limitPerSource ?? 1;
  const concurrency = options.concurrency ?? (options.phase === "process" ? 3 : 4);
  const maxArticles = options.maxArticles ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error("limit-per-source must be 1..8");
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("concurrency must be 1..8");
  if (!Number.isInteger(maxArticles) || maxArticles < 0) throw new Error("max-articles must be a nonnegative integer");
  if (["true", "1"].includes(process.env.COLLECT_ENABLED ?? "")) throw new Error("stop global COLLECT_ENABLED before a manual batch");
  if (options.phase === "process" && !options.allowModelCalls && maxArticles > 0)
    throw new Error("process requires explicit --allow-model-calls; no calls were made");
  const fingerprint = createHash("sha256").update(JSON.stringify(entries)).digest("hex");
  const statePath = resolve(options.state);
  mkdirSync(dirname(statePath), { recursive: true });
  const lockPath = `${statePath}.lock`;
  if (existsSync(lockPath)) {
    const pid = Number(readFileSync(lockPath, "utf8"));
    if (!Number.isInteger(pid) || pid < 1) throw new Error("invalid batch lock; inspect it before removing it");
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false; }
    if (alive) throw new Error(`batch lock belongs to live pid ${pid}`);
    unlinkSync(lockPath);
  }
  const lock = openSync(lockPath, "wx");
  writeFileSync(lock, String(process.pid));
  const previous = { model: config.modelCallsEnabled, push: config.feishuContentPushEnabled, index: config.indexNowSubmitEnabled };
  config.modelCallsEnabled = options.phase === "process" && options.allowModelCalls === true;
  config.feishuContentPushEnabled = false;
  config.indexNowSubmitEnabled = false;
  try {
    const [baseline] = await sql<{ n: number }[]>`SELECT coalesce(max(id), 0)::int AS n FROM receipt_attempts`;
    const progress: Progress = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {
      fingerprint, startedAt: new Date().toISOString(), attemptStart: baseline!.n, sources: {}, articles: {},
    };
    if (progress.fingerprint !== fingerprint) throw new Error("manifest differs from saved progress; choose a new state file");
    recoverProgress(progress);
    for (const e of entries) progress.sources[e.id] ??= { register: { status: "pending" }, collect: { status: "pending" }, articles: [] };
    const save = () => saveCheckpoint(statePath, progress);
    save();
    const record = async (step: Step, action: () => Promise<unknown>) => {
      if (step.status !== "pending") return;
      step.status = "running"; save();
      let pause: unknown;
      try { step.result = await action(); if (step.status === "running") step.status = "ok"; }
      catch (error) {
        step.status = /unknown|outcome|receipt.*pending/i.test(String(error)) ? "unknown" : "failed";
        // Provider wrappers redact their own errors; do not persist arbitrary URLs or credential-looking query strings.
        step.error = String(error instanceof Error ? error.message : error).replace(/([?&](?:key|token|verifycode)=)[^&#\s]+/gi, "$1[redacted]").slice(0, 1000);
        if (options.phase === "process" && step.status !== "unknown" && /\bHTTP 429\b|rate.limit|token plan/i.test(step.error)) {
          step.status = "pending";
          pause = error; // A shared provider limit pauses dispatch; articles not yet claimed stay pending.
        }
      }
      save();
      if (pause) throw pause;
    };
    if (options.phase === "register") await pool(entries, concurrency, async (e) => {
      await record(progress.sources[e.id].register, async () => {
        const sourceConfig = ["rss", "web_list", "json_list"].includes(e.kind)
          ? { ...e.config, _aihot: { ...(e.config._aihot as object ?? {}), initialBackfillLimit: limit } } : e.config;
        const rows = await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, tags, site_fulltext, enabled, interval_minutes, next_fetch_at)
          VALUES (${e.id}, ${e.name}, ${e.kind}, ${sql.json(sourceConfig as never)}, ${e.tier}, ${e.participation_mode},
                  ${e.tags}, ${e.site_fulltext}, ${e.enabled}, ${e.interval_minutes}, '2100-01-01') ON CONFLICT (id) DO NOTHING RETURNING id`;
        return { inserted: rows.length === 1, existingPreserved: rows.length === 0 };
      });
    }, options.signal);
    if (options.phase === "collect") {
      const nextByDomain = new Map<string, number>();
      let mpTail: Promise<void> = Promise.resolve();
      await pool(entries, concurrency, async (e) => {
        const source = progress.sources[e.id];
        if (source.register.status !== "ok" || source.collect.status !== "pending") return;
        const action = async () => record(source.collect, async () => {
          const [existing] = await sql<{ kind: string; config: Record<string, unknown> }[]>`SELECT kind, config FROM sources WHERE id = ${e.id}`;
          if (!existing || existing.kind !== e.kind) throw new Error("missing source or kind mismatch; existing configuration preserved");
          if (e.kind === "external") { source.collect.status = "skipped"; return { reason: "external source accepts pushed data only" }; }
          let domain = e.id;
          try { domain = new URL(String(existing.config.url ?? existing.config.feedUrl)).hostname; } catch { /* separate id bucket */ }
          const start = Math.max(Date.now(), nextByDomain.get(domain) ?? 0);
          nextByDomain.set(domain, start + 500);
          await sleep(Math.max(0, start - Date.now()));
          const result = e.kind === "mp_account" ? await checkMpAccount(e.id, "manual", { maxNew: limit })
            : await collectSource(e.id, { force: true, maxItems: limit });
          const articles = await sql<{ id: string }[]>`SELECT id FROM articles WHERE source_id = ${e.id} ORDER BY discovered_at DESC, id LIMIT ${limit}`;
          source.articles = articles.map((a) => a.id);
          for (const a of articles) progress.articles[a.id] ??= { sourceId: e.id, process: { status: "pending" } };
          const [uncertain] = await sql`SELECT 1 FROM receipts WHERE subject = ${e.id} AND status IN ('unknown', 'pending') LIMIT 1`;
          if (uncertain) throw new Error("receipt outcome unknown; inspect before retrying");
          if (result.status !== "ok") throw new Error("error" in result ? String(result.error ?? result.status) : result.status);
          return result;
        });
        if (e.kind === "mp_account") {
          const previousMp = mpTail;
          let release!: () => void;
          mpTail = new Promise<void>((done) => { release = done; });
          await previousMp;
          try { if (!options.signal?.aborted) await action(); await sleep(1000); } finally { release(); }
        } else if (!options.signal?.aborted) await action();
      }, options.signal);
    }
    if (options.phase === "process") {
      let groupTail: Promise<unknown> = Promise.resolve();
      const group = async (id: string, entry: Progress["articles"][string]) => {
        entry.stage = "group"; save();
        const grouping = groupTail.then(() => groupArticle(id));
        groupTail = grouping.catch(() => undefined); // A failed article must not stop later groups.
        await grouping;
        entry.stage = "done";
      };
      const articles = Object.entries(progress.articles).filter(([, a]) => a.process.status === "pending").slice(0, maxArticles);
      await pool(articles, concurrency, async ([id, entry]) => record(entry.process, async () => {
        const [article] = await sql<{ body_status: string; processing_state: string; kind: string; grouped_at: Date | null; relevance: string | null }[]>`
          SELECT a.body_status, a.processing_state, a.grouped_at, s.kind,
            (SELECT relevance FROM analyses WHERE article_id = a.id ORDER BY input_revision DESC, id DESC LIMIT 1) AS relevance
          FROM articles a JOIN sources s ON s.id = a.source_id
          WHERE a.id = ${id} AND a.source_id = ${entry.sourceId}`;
        if (!article) throw new Error("manifest article no longer exists");
        if (article.processing_state === "analyzed") {
          // groupArticle can mark grouped_at before rethrowing; the checkpoint's unfinished stage wins.
          if (article.relevance === "pass" && (!article.grouped_at || entry.stage === "group")) await group(id, entry);
          entry.stage = "done";
          return { state: article.processing_state, alreadyProcessed: true };
        }
        if (["blocked", "skipped"].includes(article.processing_state)) return { state: article.processing_state, alreadyProcessed: true };
        const [unknown] = await sql`SELECT 1 FROM receipts WHERE subject IN (${id}, ${`article:${id}`}) AND status IN ('unknown', 'pending') LIMIT 1`;
        if (unknown) throw new Error("article receipt outcome unknown; no automatic retry");
        entry.stage = "extract"; save();
        if (article.body_status !== "ok" && article.kind !== "mp_account") await extractArticleBody(id, false);
        entry.stage = "analyze"; save();
        const result = await processArticle(id);
        if (result.state === "unknown-receipt") throw new Error("article receipt outcome unknown");
        if (["fetching-body", "stale", "missing"].includes(result.state)) throw new Error(`processing incomplete: ${result.state}`);
        if (result.state === "pass") await group(id, entry);
        entry.stage = "done";
        return result;
      }), options.signal);
    }
    const ids = entries.map((e) => e.id);
    const [counts] = await sql<{ articles: number; published: number }[]>`
      SELECT (SELECT count(*)::int FROM articles WHERE source_id IN ${sql(ids)}) AS articles,
             (SELECT count(*)::int FROM publications WHERE source_id IN ${sql(ids)}) AS published`;
    const fees = await sql`SELECT service, currency, cost_basis, count(*)::int AS attempts, sum(cost) AS amount,
             count(*) FILTER (WHERE cost IS NULL)::int AS unpriced
      FROM receipt_attempts WHERE id > ${progress.attemptStart} GROUP BY service, currency, cost_basis ORDER BY service`;
    const sources = Object.values(progress.sources);
    const report = { manifest_sources: entries.length, registered: sources.filter((s) => s.register.status === "ok").length,
      collected_ok: sources.filter((s) => s.collect.status === "ok").length,
      failed: sources.filter((s) => [s.register.status, s.collect.status].includes("failed")).length,
      unknown: sources.filter((s) => [s.register.status, s.collect.status].includes("unknown")).length,
      pending: sources.filter((s) => s.register.status === "pending" || s.collect.status === "pending").length,
      tracked_articles: Object.keys(progress.articles).length,
      articles_processed: Object.values(progress.articles).filter((a) => a.process.status === "ok").length,
      articles_pending: Object.values(progress.articles).filter((a) => a.process.status === "pending").length,
      articles_failed: Object.values(progress.articles).filter((a) => a.process.status === "failed").length,
      articles_unknown: Object.values(progress.articles).filter((a) => a.process.status === "unknown").length,
      ...counts, receipt_cost_scope: "database attempts since batch baseline; keep all other workers stopped", receipt_costs: fees,
      interrupted: options.signal?.aborted ?? false, state: statePath };
    writeFileSync(`${statePath}.report.json`, JSON.stringify(report, null, 2), "utf8");
    return report;
  } finally {
    config.modelCallsEnabled = previous.model; config.feishuContentPushEnabled = previous.push; config.indexNowSubmitEnabled = previous.index;
    closeSync(lock); unlinkSync(lockPath);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { manifest: { type: "string" }, state: { type: "string" }, phase: { type: "string" },
    "limit-per-source": { type: "string", default: "1" }, "max-articles": { type: "string", default: "20" },
    concurrency: { type: "string" }, "allow-model-calls": { type: "boolean", default: false } } });
  const abort = new AbortController();
  const interrupt = () => { abort.abort(); shutdownSignal.abort(); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    if (!values.manifest || !values.state || !["register", "collect", "process", "report"].includes(values.phase ?? ""))
      throw new Error("usage: --manifest file --state progress.json --phase register|collect|process|report [--limit-per-source 1] [--concurrency 4] [--max-articles 20] [--allow-model-calls]");
    const report = await runBatch({ manifest: values.manifest, state: values.state, phase: values.phase as BatchOptions["phase"],
      limitPerSource: Number(values["limit-per-source"]), maxArticles: Number(values["max-articles"]),
      concurrency: values.concurrency ? Number(values.concurrency) : undefined, allowModelCalls: values["allow-model-calls"], signal: abort.signal });
    console.log(JSON.stringify(report, null, 2));
    if (report.interrupted || report.failed || report.unknown || report.articles_failed || report.articles_unknown) process.exitCode = 2;
  } catch (error) { console.error(error instanceof Error ? error.message : "batch failed"); process.exitCode = 1; }
  finally { await stopBoss(); await closeDb(); }
}
