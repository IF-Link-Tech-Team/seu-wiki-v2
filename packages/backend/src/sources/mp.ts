// WeChat official accounts. Dajiala (极致了, a paid service) supplies each account's latest posts and
// article bodies; every enabled account is checked once per source interval.
import { sql } from "../db.ts";
import { upsertMaterial, type MediaItem } from "../content/materials.ts";
import * as cheerio from "cheerio";
import { enqueue, QUEUES } from "../jobs/queue.ts";
import { queueProcessing } from "../jobs/content.ts";
import { stripTags } from "../lib/text.ts";
import { sanitizeBody } from "../content/sanitize.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { mpArticle, mpHistory, MP_RESPONSE_VERSION, type MpArticle } from "../providers/dajiala.ts";
import { BudgetExceededError, ProviderRejectedError, completeReceipt } from "../providers/receipts.ts";
import { publishArticle } from "../publication/publish.ts";

const MAX_NEW_PER_CHECK = 8;
/** Apply on every check so later runs cannot buy the history skipped during initialization. */
const RECENT_POST_WINDOW_MS = 7 * 86400_000;
/** A body missing for a passing reason is fetched again on later checks: this often, while the post is this recent. */
const BODY_RETRIES = 3;
const BODY_RETRY_WINDOW_MS = 3 * 86400_000;

/** The article body, and when it is missing for a reason that may pass (rate limit, server error, lost answer), that reason. */
async function fetchBody(url: string, sourceId: string, identity: string, nickname?: string): Promise<{ body: MpArticle | null; passing: string | null }> {
  try {
    return { body: await mpArticle(url, { subject: sourceId, identity, nickname }), passing: null };
  } catch (error) {
    if (error instanceof BudgetExceededError) throw error;
    if (error instanceof ProviderRejectedError && error.message.includes("account mismatch")) throw error;
    const final = error instanceof ProviderRejectedError && !error.retryable;
    return { body: null, passing: final ? null : String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

interface MpSource {
  id: string;
  name: string;
  config: { wxid?: string; ghid?: string; nickname?: string; url?: string };
  cursor: Record<string, unknown> | null;
  enabled: boolean;
  participation_mode: string;
}

export async function checkMpAccount(sourceId: string, reason: "schedule" | "manual", opts: { maxNew?: number } = {}) {
  const maxNew = opts.maxNew ?? MAX_NEW_PER_CHECK;
  if (!Number.isInteger(maxNew) || maxNew < 0 || maxNew > MAX_NEW_PER_CHECK) throw new Error("mp maxNew must be an integer from 0 to 8");
  const [source] = await sql<MpSource[]>`SELECT id, name, config, cursor, enabled, participation_mode FROM sources WHERE id = ${sourceId} AND kind = 'mp_account'`;
  if (!source) return { sourceId, status: "missing" as const };
  if (!source.enabled && reason !== "manual") return { sourceId, status: "paused" as const };
  const ghid = source.config.ghid ?? source.config.wxid ?? "";
  if (!ghid && !source.config.url && !source.config.nickname) return { sourceId, status: "unconfigured" as const };
  if (reason === "schedule") {
    // Claim before sending, including failed attempts. Queued retries and concurrent workers cannot
    // buy another ten-minute history key within the source interval or bypass an unresolved receipt.
    const claimed = await sql`UPDATE sources s SET last_fetch_at = now(),
        next_fetch_at = now() + make_interval(mins => interval_minutes), updated_at = now()
      WHERE s.id = ${sourceId} AND s.kind = 'mp_account' AND s.enabled
        AND (s.last_fetch_at IS NULL OR s.last_fetch_at <= now() - make_interval(mins => s.interval_minutes))
        AND (s.next_fetch_at IS NULL OR s.next_fetch_at <= now())
        AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.subject IN (s.id, 'source:' || s.id)
          AND r.status IN ('pending', 'unknown'))
      RETURNING s.id`;
    if (!claimed.length) return { sourceId, status: "not-due" as const };
  }
  const [run] = await sql<{ id: number }[]>`INSERT INTO fetch_runs (source_id, detail) VALUES (${sourceId}, ${sql.json({ reason })}) RETURNING id`;
  const firstCheck = !source.cursor?.lastCheckedAt;
  let created = 0;
  try {
    // One paid list call per account per 10-minute window, whoever asks.
    const window = `${reason === "schedule" ? "s" : "m"}:${Math.floor(Date.now() / 600_000)}`;
    const history = await mpHistory(ghid, { subject: sourceId, window, url: source.config.url, nickname: source.config.nickname });
    const posts = [...history.posts].sort((a, b) => b.post_time - a.post_time || a.position - b.position);
    let fetched = 0;
    for (const p of posts) {
      if (!p.url || !p.title || fetched >= maxNew) continue;
      const publishedAt = p.post_time ? new Date(p.post_time * 1000) : null;
      if (publishedAt && Date.now() - publishedAt.getTime() > RECENT_POST_WINDOW_MS) continue;
      // Same identity rule as every entrance: the long link without tracking parameters. A known post is
      // skipped, unless its body failed for a passing reason: then it is tried again a few times.
      const key = identityKeyForUrl(p.url);
      const [known] = key
        ? await sql<{ id: string; body_status: string; discovered_at: Date; response_version: string | null; retry: { attempts: number } | null }[]>`
            SELECT id, body_status, discovered_at, raw->'dajiala'->>'responseVersion' AS response_version,
                   raw->'dajiala'->'bodyRetry' AS retry FROM articles WHERE identity_key = ${key} LIMIT 1`
        : [];
      const retryBody = !!known?.retry && known.body_status === "none" && known.retry.attempts < BODY_RETRIES && Date.now() - known.discovered_at.getTime() < BODY_RETRY_WINDOW_MS;
      const upgradeBody = !!known && known.body_status !== "none" && known.response_version !== MP_RESPONSE_VERSION;
      if (known && !retryBody && !upgradeBody) continue;
      fetched += 1;
      // Without a body the post is listed anyway; analysis works from title and digest.
      const { body, passing } = await fetchBody(p.url, sourceId, p.sn ?? p.url, source.config.nickname);
      if (known && !body?.content && !body?.contentHtml && !body?.images.length) {
        const retry = passing ? sql`jsonb_set(raw, '{dajiala,bodyRetry}', ${sql.json({ attempts: (known.retry?.attempts ?? 0) + 1, error: passing })})` : sql`raw #- '{dajiala,bodyRetry}'`;
        await sql`UPDATE articles SET raw = ${retry} WHERE id = ${known.id}`;
        continue;
      }
      // Mode 2 returns plain text and HTML in different fields. Never label plain text as HTML.
      const html = body?.contentHtml ? sanitizeBody(body.contentHtml, p.url) : null;
      const text = body?.content?.trim() || (html ? stripTags(html.replace(/<\/p>|<br\s*\/?>/gi, "\n")).trim() : null);
      const media: MediaItem[] = [];
      const addImage = (image: MediaItem) => {
        try {
          const url = new URL(image.url, p.url);
          if (!["http:", "https:"].includes(url.protocol) || media.some((m) => m.url === url.href)) return;
          media.push({ ...image, url: url.href });
        } catch { /* malformed upstream image is omitted */ }
      };
      const cover = body?.coverUrl ?? p.cover_url;
      if (cover) addImage({ kind: "image", url: cover });
      for (const image of body?.images ?? []) addImage(image);
      if (html) cheerio.load(html)("img[src]").each((_, img) => { addImage({ kind: "image", url: img.attribs.src!, alt: img.attribs.alt ?? null }); });
      const res = await upsertMaterial({
        sourceId,
        url: p.url,
        title: p.title,
        author: body?.author ?? null,
        language: "zh",
        publishedAt,
        publishedAtPrecision: publishedAt ? "second" : "unknown",
        excerpt: p.digest ?? body?.desc ?? null,
        bodyHtml: html,
        bodyText: text || null,
        bodyStatus: text ? "ok" : "none",
        media,
        via: "fetch",
        backfill: firstCheck ? "first-import" : null,
        raw: {
          dajiala: {
            position: p.position, sn: p.sn ?? null, original: p.original ?? null, itemShowType: p.item_show_type ?? null, cover: cover ?? null,
            ghid: body?.ghid ?? history.ghid, biz: body?.biz ?? null, nickname: body?.nickname ?? history.nickname,
            historyReceiptId: history.receiptId, articleReceiptId: body?.receiptId ?? null,
            ...(body ? { responseVersion: MP_RESPONSE_VERSION } : {}),
            ...(passing ? { bodyRetry: { attempts: 1, error: passing } } : {}),
          },
        },
      });
      if (body) await completeReceipt(sql, body.receiptId);
      // A body fetched again arrives as a new revision (analysed again); stop retrying it.
      if (known) await sql`UPDATE articles SET raw = raw #- '{dajiala,bodyRetry}' WHERE id = ${known.id}`;
      if (res.created || res.revised) {
        created += res.created ? 1 : 0;
        await queueProcessing(res.articleId);
      } else if (res.enriched) await publishArticle(res.articleId);
    }
    const cursor = { ...(source.cursor ?? {}), lastCheckedAt: new Date().toISOString(), lastPostTime: posts[0]?.post_time ?? source.cursor?.lastPostTime ?? null, remainMoney: history.remainMoney };
    await sql`
      UPDATE sources SET last_fetch_at = now(), last_ok_at = now(), fail_count = 0, last_error = NULL, health = 'ok', cursor = ${sql.json(cursor as never)},
        next_fetch_at = now() + make_interval(mins => interval_minutes), updated_at = now()
      WHERE id = ${sourceId}`;
    await sql`UPDATE fetch_runs SET status = 'ok', finished_at = now(), found_count = ${posts.length}, new_count = ${created} WHERE id = ${run!.id}`;
    await completeReceipt(sql, history.receiptId);
    return { sourceId, status: "ok" as const, found: posts.length, created, reused: history.reused };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 500);
    const soft = error instanceof BudgetExceededError || (error instanceof ProviderRejectedError && error.retryable);
    await sql`
      UPDATE sources SET last_fetch_at = now(), last_error = ${message},
        fail_count = CASE WHEN ${soft} THEN fail_count ELSE fail_count + 1 END,
        health = CASE WHEN ${soft} THEN health WHEN fail_count + 1 >= 3 THEN 'failing' ELSE 'degraded' END, updated_at = now()
      WHERE id = ${sourceId}`;
    await sql`UPDATE fetch_runs SET status = 'failed', finished_at = now(), new_count = ${created}, error = ${message} WHERE id = ${run!.id}`;
    if (soft && reason === "manual") throw error; // Scheduled failures wait for their next interval.
    return { sourceId, status: "failed" as const, error: message };
  }
}

/** Every enabled account is checked once per its interval (the paid list call is the cost). */
export async function scheduleMpReconcile(now = new Date()) {
  const rows = await sql<{ id: string }[]>`
    SELECT s.id FROM sources s WHERE s.kind = 'mp_account' AND s.enabled
      AND (s.last_fetch_at IS NULL OR s.last_fetch_at <= ${now}::timestamptz - make_interval(mins => s.interval_minutes))
      AND (s.next_fetch_at IS NULL OR s.next_fetch_at <= ${now})
      AND NOT EXISTS (SELECT 1 FROM receipts r WHERE r.subject IN (s.id, 'source:' || s.id)
        AND r.status IN ('pending', 'unknown'))`;
  let enqueued = 0;
  for (const s of rows) {
    await enqueue(QUEUES.mpCheck, { sourceId: s.id, reason: "schedule" }, { singletonKey: `mp:${s.id}` });
    enqueued += 1;
  }
  return { enqueued };
}
