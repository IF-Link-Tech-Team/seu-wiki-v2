// A manifest-scoped daily WeChat loop. No global scheduler or processing workers.
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, openSync, closeSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const DAY = 86400_000;
interface MpRow {
  id: string; enabled: boolean; interval_minutes: number;
  last_fetch_at: Date | string | null; next_fetch_at: Date | string | null; unknown_receipt?: boolean;
}
export function parseMpManifest(value: unknown): string[] {
  const rows = Array.isArray(value) ? value : (value as { entries?: unknown })?.entries;
  if (!Array.isArray(rows) || !rows.length) throw new Error("manifest must contain daily mp_account entries");
  const ids = rows.map((row) => {
    if (!row || typeof row.id !== "string" || !row.id || row.kind !== "mp_account" || row.interval_minutes !== 1440)
      throw new Error("manifest must contain only mp_account IDs with interval_minutes=1440");
    return row.id as string;
  });
  if (new Set(ids).size !== ids.length) throw new Error("duplicate manifest source ID");
  return ids;
}
const timestamp = (value: Date | string | null | undefined) => value == null ? -Infinity : new Date(value).getTime();
export function selectDueMpSources(rows: MpRow[], now: number, attemptedAt: Record<string, string> = {}): MpRow[] {
  return rows.filter((row) => row.enabled && row.interval_minutes === 1440 && !row.unknown_receipt &&
    Math.max(timestamp(row.last_fetch_at) + DAY, timestamp(row.next_fetch_at), timestamp(attemptedAt[row.id]) + DAY) <= now);
}
interface TickOptions { now: () => number; sleep: (ms: number) => Promise<unknown>; signal?: AbortSignal }
export async function runDueChecks(rows: MpRow[], attemptedAt: Record<string, string>,
  check: (id: string) => Promise<{ status: string }>, progress: (id: string, status?: string) => void,
  options: TickOptions) {
  const due = selectDueMpSources(rows, options.now(), attemptedAt);
  for (const row of due) {
    if (options.signal?.aborted) break;
    // Persist before sending: a crash with an uncertain outcome must not create another paid call on restart.
    attemptedAt[row.id] = new Date(options.now()).toISOString(); progress(row.id);
    let status: string;
    try { status = (await check(row.id)).status; } catch { status = "failed"; }
    progress(row.id, status);
    if (!options.signal?.aborted) await options.sleep(1000);
  }
}
interface WatchState {
  manifestHash: string; pid: number; running: boolean; startedAt: string; heartbeatAt: string;
  ticks: number; checks: number; ok: number; failed: number; skipped: number; due: number; blocked: number;
  manifestSources: number; enabledSources: number; nonDailyIntervals: number;
  attemptedAt: Record<string, string>;
}
export async function watchMpSources(options: { manifest: string; state: string; run?: boolean; signal?: AbortSignal }) {
  const ids = parseMpManifest(JSON.parse(readFileSync(options.manifest, "utf8").replace(/^\uFEFF/, "")));
  const manifestHash = createHash("sha256").update(JSON.stringify([...ids].sort())).digest("hex");
  const statePath = resolve(options.state), lockPath = `${statePath}.lock`;
  const previous: WatchState | undefined = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : undefined;
  if (previous && previous.manifestHash !== manifestHash) throw new Error("manifest differs from watcher state; use a new state path");
  const state: WatchState = previous ?? { manifestHash, pid: process.pid, running: false,
    startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), ticks: 0, checks: 0, ok: 0, failed: 0, skipped: 0,
    due: 0, blocked: 0, manifestSources: ids.length, enabledSources: 0, nonDailyIntervals: 0, attemptedAt: {} };
  const [{ sql, closeDb }, { stopBoss }, { config }, { checkMpAccount }, { saveCheckpoint }] = await Promise.all([
    import("../packages/backend/src/db.ts"), import("../packages/backend/src/jobs/queue.ts"),
    import("../packages/backend/src/config.ts"), import("../packages/backend/src/sources/mp.ts"), import("./collect-source-batch.ts"),
  ]);
  config.modelCallsEnabled = false; config.feishuContentPushEnabled = false; config.indexNowSubmitEnabled = false;
  const load = (selected: string[]) => sql<MpRow[]>`SELECT s.id, s.enabled, s.interval_minutes, s.last_fetch_at, s.next_fetch_at,
    EXISTS(SELECT 1 FROM receipts r WHERE r.subject IN (s.id, 'source:' || s.id)
      AND r.status IN ('pending', 'unknown')) AS unknown_receipt
    FROM sources s WHERE s.id IN ${sql(selected)} AND s.kind = 'mp_account' AND s.enabled ORDER BY s.id`;
  let lock: number | undefined;
  const save = () => { state.heartbeatAt = new Date().toISOString(); saveCheckpoint(statePath, state); };
  const wait = async (ms: number) => { try { await sleep(ms, undefined, { signal: options.signal }); }
    catch (error) { if (!options.signal?.aborted) throw error; } };
  try {
    if (options.run) {
      mkdirSync(dirname(statePath), { recursive: true });
      if (existsSync(lockPath)) {
        const pid = Number(readFileSync(lockPath, "utf8"));
        if (!Number.isInteger(pid) || pid < 1) throw new Error("invalid watcher lock; inspect before removing");
        try { process.kill(pid, 0); throw new Error(`watcher already running with pid ${pid}`); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
        unlinkSync(lockPath);
      }
      lock = openSync(lockPath, "wx"); writeFileSync(lock, String(process.pid));
      state.pid = process.pid; state.running = true; save();
    }
    do {
      const started = Date.now();
      const rows = await load(ids);
      const due = selectDueMpSources(rows, started, state.attemptedAt);
      if (!options.run) {
        console.log(JSON.stringify({ dryRun: true, manifestSources: ids.length, enabledSources: rows.length,
          due: due.map((row) => row.id), blockedUnknownReceipts: rows.filter((row) => row.unknown_receipt).map((row) => row.id),
          nonDailyIntervals: rows.filter((row) => row.interval_minutes !== 1440).map((row) => row.id) }, null, 2));
        return;
      }
      state.ticks++; state.due = due.length; state.blocked = rows.filter((row) => row.unknown_receipt).length;
      state.manifestSources = ids.length; state.enabledSources = rows.length;
      state.nonDailyIntervals = rows.filter((row) => row.interval_minutes !== 1440).length; save();
      await runDueChecks(rows, state.attemptedAt, async (id) => {
        // The serial sweep can outlive a concurrent manual check. Re-read before paying.
        if (!selectDueMpSources(await load([id]), Date.now()).length) return { status: "skipped" };
        return checkMpAccount(id, "schedule");
      }, (_id, status) => {
        if (status) { state.checks++; if (status === "ok") state.ok++; else if (status === "skipped") state.skipped++; else state.failed++; }
        save();
      }, { now: Date.now, sleep: wait, signal: options.signal });
      if (!options.signal?.aborted) await wait(Math.max(0, 60_000 - (Date.now() - started)));
    } while (!options.signal?.aborted);
  } finally {
    try { if (lock !== undefined) { state.running = false; save(); } }
    finally {
      if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
      await stopBoss(); await closeDb();
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { manifest: { type: "string" }, state: { type: "string" }, run: { type: "boolean", default: false } } });
  const abort = new AbortController();
  process.once("SIGINT", () => abort.abort()); process.once("SIGTERM", () => abort.abort());
  try {
    if (!values.manifest || !values.state) throw new Error("usage: --manifest industry/wechat-sources.json --state .data/daily-watcher.json [--run]");
    await watchMpSources({ manifest: values.manifest, state: values.state, run: values.run, signal: abort.signal });
  } catch { console.error("公众号每日检查脚本已停止；请核对清单、进度文件和回执状态。"); process.exitCode = 1; }
}
