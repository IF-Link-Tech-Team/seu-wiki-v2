// Collection picks up where it stopped: an X search longer than one run continues in later runs until
// it meets the old watermark (no post in between is skipped, no page is bought twice), and a WeChat body
// that failed for a passing reason is fetched again on the next check.
import { Reply, stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { collectSource } from "@aihot/backend/sources/collect";
import { checkMpAccount } from "@aihot/backend/sources/mp";
import { mpHistory, mpArticle } from "@aihot/backend/providers/dajiala";

const T = tag();
const X_SOURCE = `test-x-${T}`;
const MP_SOURCE = `test-mp-${T}`;

// SocialData: 450 posts newer than the watermark, newest first, 20 a page; `cursor` is the page number.
const BASE = BigInt(Date.now()) * 1000n;
const WATERMARK = BASE + 100n;
const POSTS = Array.from({ length: 450 }, (_, i) => BASE + 550n - BigInt(i));
const tweet = (id: bigint) => ({
  id_str: String(id), tweet_created_at: new Date(Date.now() - Number(BASE + 550n - id) * 60_000).toISOString(),
  full_text: `Post ${id} ${T}`, lang: "en", user: { name: "Test account", screen_name: `acct${T}` },
});
const socialdata = await stub((_hit, req) => {
  const u = new URL(req.url, "http://stub");
  const since = BigInt(/since_id:(\d+)/.exec(u.searchParams.get("query") ?? "")?.[1] ?? "0");
  const page = Number(u.searchParams.get("cursor") ?? 0);
  const ids = POSTS.filter((id) => id > since);
  return { tweets: ids.slice(page * 20, page * 20 + 20).map(tweet), next_cursor: (page + 1) * 20 < ids.length ? String(page + 1) : null };
});

// Dajiala: one new post whose body answers 503 the first time.
const MP_URL = `https://mp.weixin.qq.com/s/test-${T}`;
let bodyCalls = 0;
const dajiala = await stub((_hit, req) => {
  if (req.url.startsWith("/fbmain/monitor/v3/history_by_ghid")) {
    const body = JSON.parse(req.body);
    assert.equal(body.offset, "");
    assert.equal(body.verifycode, process.env.DAJIALA_VERIFYCODE ?? "");
    return { code: 0, cost: 0.14, AccountInfo: { NickName: "测试学院", UserName: body.ghid }, MsgList: { Msg: [
      { AppMsg: { DetailInfo: Array.from({ length: body.ghid.startsWith("gh_limit_") ? 5 : 1 }, (_, i) => ({
        ItemIndex: i + 1, ContentUrl: body.ghid.startsWith("gh_limit_") ? `${MP_URL}-limit-${i}` : MP_URL,
        Title: `公众号文章 ${T}`, send_time: Math.floor(Date.now() / 1000) - 3600,
        Digest: "摘要 2026-10-01", Sn: `sn-${body.ghid.startsWith("gh_limit_") ? "limit-" : ""}${T}-${i}`, CoverImgUrl: "https://mmbiz.qpic.cn/cover.png",
      })) } },
    ] }, remain_money: 100 };
  }
  bodyCalls += 1;
  if (bodyCalls === 1) return new Reply(503, { error: "busy" });
  assert.equal(new URL(req.url, "http://stub").searchParams.get("mode"), "2");
  return { code: 0, cost_money: 0.03, title: `公众号文章 ${T}`, nick_name: "测试学院", user_name: `gh_${T}`,
    content: `正文第一段 ${T}\n正文第二段`, content_multi_text: `<p>正文第一段 ${T}</p><p>正文第二段<img data-src="https://mmbiz.qpic.cn/body.png"></p><script>alert(1)</script>`,
    cdn_url: "https://mmbiz.qpic.cn/cover.png", picture_page_info_list: [{ cdn_url: "https://mmbiz.qpic.cn/body.png", width: 640, height: 1000 }], author: "作者", desc: "描述" };
});

process.env.SOCIALDATA_BASE_URL = socialdata.url;
process.env.SOCIALDATA_API_KEY = "test-key";
process.env.DAJIALA_BASE_URL = dajiala.url;
process.env.DAJIALA_KEY = "test-key";
config.allowPrivateNetworkFetch = true;

let savedBudgets: Array<{ service: string; per_minute: number; per_hour: number; per_day: number }> = [];
before(async () => {
  savedBudgets = await sql`SELECT service, per_minute, per_hour, per_day FROM budgets WHERE service IN ('socialdata', 'dajiala')`;
  await sql`UPDATE budgets SET per_minute = 1000, per_hour = 10000, per_day = 100000 WHERE service IN ('socialdata', 'dajiala')`;
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, cursor, next_fetch_at)
            VALUES (${X_SOURCE}, 'Test X', 'x_search', ${sql.json({ query: `from:acct${T}` })}, 'T1', 'editorial',
                    ${sql.json({ initializedAt: new Date().toISOString(), lastTweetId: String(WATERMARK) })}, '2100-01-01'),
                   (${MP_SOURCE}, 'Test mp', 'mp_account', ${sql.json({ ghid: `gh_${T}` })}, 'T1', 'editorial',
                    ${sql.json({ lastCheckedAt: new Date().toISOString() })}, '2100-01-01')`;
});
after(async () => {
  for (const b of savedBudgets) await sql`UPDATE budgets SET per_minute = ${b.per_minute}, per_hour = ${b.per_hour}, per_day = ${b.per_day} WHERE service = ${b.service}`;
  await socialdata.close();
  await dajiala.close();
  await stopBoss();
  await closeDb();
});

test("an X search longer than one run is read to the old watermark over the next runs", async () => {
  const stored = async () => Number((await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${X_SOURCE}`)[0]!.n);
  const cursor = async () => (await sql<{ cursor: { lastTweetId: string; xBacklog?: unknown[] } }[]>`SELECT cursor FROM sources WHERE id = ${X_SOURCE}`)[0]!.cursor;

  const first = await collectSource(X_SOURCE, { force: true });
  assert.equal(first.status, "ok");
  assert.equal(await stored(), 400, "a run reads its own pages and ten more of the stretch left over");
  assert.equal((await cursor()).lastTweetId, String(BASE + 550n), "the watermark moves to the newest post");
  assert.equal((await cursor()).xBacklog?.length, 1, "the unread stretch is kept for the next run");
  const [run] = await sql<{ detail: { truncated: boolean; backlog: number } }[]>`SELECT detail FROM fetch_runs WHERE source_id = ${X_SOURCE} ORDER BY id DESC LIMIT 1`;
  assert.deepEqual([run!.detail.truncated, run!.detail.backlog], [true, 1], "the admin sees the stretch still to read");

  const second = await collectSource(X_SOURCE, { force: true });
  assert.equal(second.status, "ok");
  assert.equal(await stored(), 450, "every post between the old watermark and the newest is stored");
  assert.equal((await cursor()).xBacklog, undefined, "nothing is left to read");
  assert.equal(socialdata.hits(), 20 + 1 + 3, "no page is requested twice");
});

test("a WeChat body that failed for a passing reason is fetched on the next check and analysed again", async () => {
  const article = async () =>
    (await sql<{ body_status: string; revision: number; retry: { attempts: number } | null }[]>`
      SELECT body_status, revision, raw->'dajiala'->'bodyRetry' AS retry FROM articles WHERE source_id = ${MP_SOURCE}`)[0]!;

  const first = await checkMpAccount(MP_SOURCE, "manual");
  assert.equal(first.status, "ok");
  assert.deepEqual({ ...(await article()) }, { body_status: "none", revision: 1, retry: { attempts: 1, error: "dajiala HTTP 503" } });

  const second = await checkMpAccount(MP_SOURCE, "manual");
  assert.equal(second.status, "ok");
  assert.equal(bodyCalls, 2, "the body is asked for once more");
  const now = await article();
  assert.deepEqual([now.body_status, now.revision, now.retry], ["ok", 2, null], "the body arrives as a new revision and retrying stops");
  const [queued] = await sql<{ processing_state: string }[]>`SELECT processing_state FROM articles WHERE source_id = ${MP_SOURCE}`;
  assert.equal(queued!.processing_state, "new", "the article goes back to analysis");

  await checkMpAccount(MP_SOURCE, "manual");
  assert.equal(bodyCalls, 2, "a body already stored is not bought again");
  const [stored] = await sql<{ body_html: string; media: Array<{ url: string }>; raw: { dajiala: { articleReceiptId: number } } }[]>`
    SELECT body_html, media, raw FROM articles WHERE source_id = ${MP_SOURCE}`;
  assert.match(stored!.body_html, /<img src="https:\/\/mmbiz.qpic.cn\/body.png"/);
  assert.doesNotMatch(stored!.body_html, /script/);
  assert.deepEqual(stored!.media.map((m) => m.url), ["https://mmbiz.qpic.cn/cover.png", "https://mmbiz.qpic.cn/body.png"]);
  assert.ok(stored!.raw.dajiala.articleReceiptId > 0);
});

test("Dajiala responses are retained and reused; source-name mismatch never buys article details", async () => {
  const opts = { subject: `mp-provider-${T}`, window: "test", nickname: "测试学院" };
  const before = dajiala.hits();
  const first = await mpHistory(`gh_provider_${T}`, opts);
  const second = await mpHistory(`gh_provider_${T}`, opts);
  assert.equal(dajiala.hits(), before + 1);
  assert.equal(second.reused, true);
  assert.equal(second.receiptId, first.receiptId);
  const [receipt] = await sql<{ cost: number; response: { AccountInfo: { NickName: string } } }[]>`SELECT cost, response FROM receipts WHERE id = ${first.receiptId}`;
  assert.equal(Number(receipt!.cost), 0.14);
  assert.equal(receipt!.response.AccountInfo.NickName, "测试学院");
  await assert.rejects(mpHistory(`gh_provider_${T}`, { ...opts, nickname: "误匹配" }), /account mismatch/);
  assert.equal(dajiala.hits(), before + 1, "mismatched name rejects the cached history without another paid call");
  const articleOpts = { subject: opts.subject, identity: `provider-detail-${T}`, nickname: "测试学院" };
  const article = await mpArticle(MP_URL, articleOpts);
  await mpArticle(MP_URL, articleOpts);
  assert.equal(dajiala.hits(), before + 2, "detail is also reused");
  assert.equal(article.images.length, 1);
});

test("a controlled WeChat batch buys at most three new bodies and does not rebuy stored ones", async () => {
  const id = `mp-limit-${T}`;
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, cursor, next_fetch_at)
    VALUES (${id}, '测试学院', 'mp_account', ${sql.json({ ghid: `gh_limit_${T}`, nickname: "测试学院" })}, 'T1', 'editorial',
            ${sql.json({ lastCheckedAt: new Date().toISOString() })}, '2100-01-01')`;
  const before = dajiala.hits();
  const first = await checkMpAccount(id, "manual", { maxNew: 3 });
  assert.equal(first.status, "ok");
  assert.equal(first.created, 3);
  assert.equal(dajiala.hits(), before + 4, "one list and three new details");
  const second = await checkMpAccount(id, "manual", { maxNew: 3 });
  assert.equal(second.created, 2, "only the remaining bodies are bought");
  assert.equal(dajiala.hits(), before + 6);
  await checkMpAccount(id, "manual", { maxNew: 3 });
  assert.equal(dajiala.hits(), before + 6, "no known body or same-window list is bought twice");
});

test("a short verification code cannot corrupt numeric status or cost while redacting responses", async () => {
  process.env.DAJIALA_VERIFYCODE = "0";
  try {
    const result = await mpHistory(`gh_verify_${T}`, { subject: `mp-verify-${T}`, window: "verify", nickname: "测试学院" });
    assert.equal(result.posts.length, 1);
    assert.equal(result.posts[0]!.digest, "摘要 2026-10-01", "short verification code must not replace ordinary content digits");
    const [receipt] = await sql<{ response: { code: number }; cost: number }[]>`SELECT response, cost FROM receipts WHERE id = ${result.receiptId}`;
    assert.equal(receipt!.response.code, 0);
    assert.equal(Number(receipt!.cost), 0.14);
  } finally {
    delete process.env.DAJIALA_VERIFYCODE;
  }
});
