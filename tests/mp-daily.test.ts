import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { checkMpAccount, scheduleMpReconcile } from "@aihot/backend/sources/mp";

const T = tag(), day = 86400_000;
const provider = await stub((_hit, req) => {
  const ghid = JSON.parse(req.body).ghid;
  if (ghid.includes("unknown")) return new Reply(200, undefined); // Received an empty response after sending.
  if (ghid.includes("fail")) return new Reply(503, { message: "unavailable" });
  return { code: 0, cost: 0.14, AccountInfo: { NickName: "测试学院", UserName: ghid }, MsgList: { Msg: [] } };
});
process.env.DAJIALA_BASE_URL = provider.url; process.env.DAJIALA_KEY = "daily-test-key";
config.allowPrivateNetworkFetch = true;
let budgets: Array<{ per_minute: number; per_hour: number; per_day: number }> = [];
before(async () => {
  budgets = await sql`SELECT per_minute, per_hour, per_day FROM budgets WHERE service = 'dajiala'`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service = 'dajiala'`;
});
after(async () => {
  for (const b of budgets) await sql`UPDATE budgets SET per_minute = ${b.per_minute}, per_hour = ${b.per_hour}, per_day = ${b.per_day} WHERE service = 'dajiala'`;
  await provider.close(); await stopBoss(); await closeDb();
});
async function add(suffix: string) {
  const id = `mp-daily-${suffix}-${T}`;
  await sql`INSERT INTO sources (id, name, kind, config, enabled, interval_minutes, cursor, last_fetch_at, next_fetch_at)
    VALUES (${id}, '每日测试', 'mp_account', ${sql.json({ ghid: `gh_${suffix}_${T}`, nickname: "测试学院" })}, true, 1440,
      ${sql.json({ lastCheckedAt: new Date(Date.now() - 2 * day).toISOString() })}, now() - interval '2 days', now() - interval '1 day')`;
  return id;
}
async function makeDue(id: string) {
  await sql`UPDATE sources SET last_fetch_at = now() - interval '2 days', next_fetch_at = now() - interval '1 day' WHERE id = ${id}`;
}

test("a failed scheduled check and its queued retry spend only one daily attempt; manual remains explicit", async () => {
  const id = await add("fail"), before = provider.hits();
  assert.equal((await checkMpAccount(id, "schedule")).status, "failed");
  assert.equal((await checkMpAccount(id, "schedule")).status, "not-due");
  assert.equal(provider.hits(), before + 1);
  await scheduleMpReconcile();
  const [jobs] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'sources.mp' AND data->>'sourceId' = ${id}`;
  assert.equal(jobs!.n, 0, "a failed success cursor cannot cause another reconcile during the day");
  await assert.rejects(checkMpAccount(id, "manual"), /HTTP 503/);
  assert.equal(provider.hits(), before + 2, "manual requests retain their explicit override");
  await makeDue(id);
  assert.equal((await checkMpAccount(id, "schedule")).status, "failed");
  assert.equal(provider.hits(), before + 3, "a later daily attempt is allowed");
});

test("concurrent scheduled jobs atomically claim only one attempt", async () => {
  const id = await add("concurrent"), before = provider.hits();
  const results = await Promise.all([checkMpAccount(id, "schedule"), checkMpAccount(id, "schedule")]);
  assert.deepEqual(results.map((r) => r.status).sort(), ["not-due", "ok"]);
  assert.equal(provider.hits(), before + 1);
});

test("unknown history outcomes cannot be bypassed using another schedule window the next day", async () => {
  const id = await add("unknown"), before = provider.hits();
  assert.equal((await checkMpAccount(id, "schedule")).status, "failed");
  const [receipt] = await sql<{ status: string }[]>`SELECT status FROM receipts WHERE subject = ${id} ORDER BY id DESC LIMIT 1`;
  assert.equal(receipt!.status, "unknown");
  await makeDue(id);
  assert.equal((await checkMpAccount(id, "schedule")).status, "not-due");
  assert.equal(provider.hits(), before + 1);
  await scheduleMpReconcile(new Date(Date.now() + 3 * day));
  const [jobs] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'sources.mp' AND data->>'sourceId' = ${id}`;
  assert.equal(jobs!.n, 0);
});

test("budget rejection also claims the day without sending a request", async () => {
  const id = await add("budget"), before = provider.hits();
  await sql`UPDATE budgets SET per_minute = 0 WHERE service = 'dajiala'`;
  try {
    assert.equal((await checkMpAccount(id, "schedule")).status, "failed");
    assert.equal((await checkMpAccount(id, "schedule")).status, "not-due");
    assert.equal(provider.hits(), before);
  } finally { await sql`UPDATE budgets SET per_minute = 1000 WHERE service = 'dajiala'`; }
});

test("reconcile respects both timestamps rather than only the last successful cursor", async () => {
  const id = await add("clock");
  const now = new Date();
  await sql`UPDATE sources SET last_fetch_at = ${now}, next_fetch_at = ${new Date(now.getTime() + day)} WHERE id = ${id}`;
  await scheduleMpReconcile(new Date(now.getTime() + day - 1));
  let [jobs] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'sources.mp' AND data->>'sourceId' = ${id}`;
  assert.equal(jobs!.n, 0);
  await scheduleMpReconcile(new Date(now.getTime() + day));
  [jobs] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM pgboss.job WHERE name = 'sources.mp' AND data->>'sourceId' = ${id}`;
  assert.equal(jobs!.n, 1);
});
