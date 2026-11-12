import assert from "node:assert/strict";
import { test } from "node:test";
import { parseMpManifest, selectDueMpSources, runDueChecks } from "../scripts/watch-mp-sources.ts";

const now = Date.parse("2026-11-05T10:00:00Z");
const day = 86400_000;
const source = { id: "mp-one", enabled: true, interval_minutes: 1440, last_fetch_at: null, next_fetch_at: null };

test("watcher accepts only explicit daily WeChat manifests", () => {
  assert.deepEqual(parseMpManifest({ entries: [{ id: "mp-one", kind: "mp_account", interval_minutes: 1440, evidence: "ignored" }] }), ["mp-one"]);
  assert.throws(() => parseMpManifest([{ id: "web", kind: "web_list", interval_minutes: 1440 }]));
  assert.throws(() => parseMpManifest([{ id: "mp", kind: "mp_account", interval_minutes: 60 }]));
  assert.throws(() => parseMpManifest([{ id: "mp", kind: "mp_account", interval_minutes: 1440 }, { id: "mp", kind: "mp_account", interval_minutes: 1440 }]));
});

test("fake clock respects both daily bounds, disabled sources, unknown receipts and restart cooldown", () => {
  const rows = [source,
    { ...source, id: "today", last_fetch_at: new Date(now - 60000) },
    { ...source, id: "due", last_fetch_at: new Date(now - day), next_fetch_at: new Date(now) },
    { ...source, id: "future", last_fetch_at: new Date(now - day), next_fetch_at: new Date(now + 1) },
    { ...source, id: "disabled", enabled: false }, { ...source, id: "fast", interval_minutes: 60 },
    { ...source, id: "unknown", unknown_receipt: true }, { ...source, id: "invalid", last_fetch_at: "bad date" },
    { ...source, id: "already-attempted" }, { ...source, id: "sentinel", next_fetch_at: "2100-01-01T00:00:00Z" }];
  const attempts = { "already-attempted": new Date(now - 1).toISOString() };
  assert.deepEqual(selectDueMpSources(rows, now, attempts).map(r => r.id), ["mp-one", "due"]);
  assert.deepEqual(selectDueMpSources([{ ...source, last_fetch_at: new Date(now) }], now + day - 1), []);
  assert.equal(selectDueMpSources([{ ...source, last_fetch_at: new Date(now) }], now + day).length, 1);
});

test("one failed source does not repeat or overlap, and interruption waits for the current check", async () => {
  const attempts: Record<string, string> = {}, calls: string[] = [];
  const abort = new AbortController();
  let active = 0, maximum = 0;
  const rows = [source, { ...source, id: "mp-two" }, { ...source, id: "mp-three" }];
  const check = async (id: string) => {
    calls.push(id); maximum = Math.max(maximum, ++active);
    await Promise.resolve(); active--;
    if (id === "mp-one") throw new Error("unknown response with credentials must never be saved");
    abort.abort(); return { status: "ok" };
  };
  const outcomes: string[] = [];
  await runDueChecks(rows, attempts, check, (id, result) => { if (result) outcomes.push(`${id}:${result}`); },
    { now: () => now, sleep: async () => {}, signal: abort.signal });
  assert.deepEqual(calls, ["mp-one", "mp-two"]);
  assert.equal(maximum, 1); assert.equal(active, 0);
  assert.deepEqual(outcomes, ["mp-one:failed", "mp-two:ok"]);
  assert.deepEqual(selectDueMpSources(rows, now + 60000, attempts).map(r => r.id), ["mp-three"]);
});
