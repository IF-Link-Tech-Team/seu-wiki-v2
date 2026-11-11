import { SUBSCRIPTION_TAXONOMY } from "@aihot/industry/subscription-v2";
import type { SubscriptionItem, SubscriptionResponse } from "@aihot/contracts/subscription";
import { sql } from "../db.ts";
import { listedCondition } from "./items.ts";
import { annotateSubscription, matchSubscription, normalizeSubscriptionProfile } from "./subscription-rules.ts";

const PAGE_SIZE = 25;
const shanghaiDay = (date: Date) => new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, 10);

export async function loadSubscription(input: { profile: unknown; asOf?: string; lane: SubscriptionItem["lane"] | "feed"; page: number; q: string }): Promise<SubscriptionResponse> {
  const profile = normalizeSubscriptionProfile(input.profile);
  const now = new Date();
  const asOf = input.asOf ?? shanghaiDay(now);
  const end = input.asOf ? new Date(`${input.asOf}T23:59:59.999+08:00`) : null;
  const visibleAt = end && end < now ? end : now;
  // Stream the public archive in batches. The matching rules run before pagination, so older
  // matches are reachable without keeping the whole archive and its annotations in memory.
  const rows = sql<{ id: string; title: string; summary: string | null; source: string; at: Date }[]>`
    SELECT p.article_id AS id, p.title, p.summary, s.name AS source, p.timeline_at AS at
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(visibleAt)} AND p.eligible
      ${end ? sql`AND p.timeline_at <= ${end}` : sql``}
    ORDER BY p.timeline_at DESC, p.article_id DESC`.cursor(250);
  const counts = { matched: 0, possible: 0, excluded: 0 };
  const quality = { noTopics: 0, unknownAudience: 0, missingSummary: 0 };
  const q = input.q.toLowerCase();
  let total = 0;
  let matches = 0;
  let oldest: Date | null = null;
  let newest: Date | null = null;
  let lastPage: SubscriptionItem[] = [];
  let requestedPage: SubscriptionItem[] = [];
  for await (const batch of rows) {
    for (const row of batch) {
      total++;
      newest ??= row.at;
      oldest = row.at;
      const annotation = annotateSubscription(row, profile.mode !== undefined);
      const match = matchSubscription(annotation, profile, asOf);
      counts[match.lane]++;
      if (!annotation.topics.length) quality.noTopics++;
      if (annotation.warnings.includes("适用对象未明确")) quality.unknownAudience++;
      if (annotation.warnings.includes("摘要缺失或不可用")) quality.missingSummary++;
      if (input.lane === "feed" ? match.lane === "excluded" : match.lane !== input.lane) continue;
      if (q && !`${row.title} ${row.summary ?? ""} ${row.source} ${annotation.topics.join(" ")}`.toLowerCase().includes(q)) continue;
      if (matches % PAGE_SIZE === 0) {
        lastPage = [];
        if (Math.floor(matches / PAGE_SIZE) + 1 === input.page) requestedPage = lastPage;
      }
      matches++;
      lastPage.push({ id: row.id, title: row.title, summary: row.summary, source: row.source,
        publishedAt: row.at.toISOString(), annotation, ...match });
    }
  }
  const pageCount = Math.max(1, Math.ceil(matches / PAGE_SIZE));
  const page = Math.min(input.page, pageCount);
  return {
    version: SUBSCRIPTION_TAXONOMY.version, profile, asOf,
    from: oldest ? shanghaiDay(oldest) : null, to: newest ? shanghaiDay(newest) : null,
    total, counts, items: page === input.page ? requestedPage : lastPage, page, pageCount, quality,
  };
}
