import { SUBSCRIPTION_TAXONOMY } from "@aihot/industry/subscription-v2";
import type { SubscriptionItem, SubscriptionResponse } from "@aihot/contracts/subscription";
import { sql } from "../db.ts";
import { listedCondition } from "./items.ts";
import { annotateSubscription, matchSubscription, normalizeSubscriptionProfile } from "./subscription-rules.ts";

export async function loadSubscription(input: { profile: unknown; asOf: string; lane: SubscriptionItem["lane"] | "feed"; page: number; q: string }): Promise<SubscriptionResponse> {
  const profile = normalizeSubscriptionProfile(input.profile);
  const end = new Date(`${input.asOf}T23:59:59.999+08:00`);
  const start = new Date(`${input.asOf}T00:00:00+08:00`);
  start.setUTCDate(start.getUTCDate() - 30);
  // This experimental reader is bounded, with truncation surfaced explicitly. It reads exactly
  // the eligible public projection, not private material, raw bodies or unpublished analyses.
  const rows = await sql<{ id: string; title: string; summary: string | null; source: string; at: Date }[]>`
    SELECT p.article_id AS id, p.title, p.summary, s.name AS source, p.timeline_at AS at
    FROM publications p JOIN sources s ON s.id = p.source_id
    WHERE ${listedCondition(new Date(Math.min(end.getTime(), Date.now())))} AND p.eligible
      AND p.timeline_at >= ${start} AND p.timeline_at <= ${end}
    ORDER BY p.timeline_at DESC, p.article_id DESC LIMIT 5001`;
  const all: SubscriptionItem[] = rows.slice(0,5000).map(row => {
    const annotation = annotateSubscription(row, profile.mode !== undefined);
    return { id: row.id, title: row.title, summary: row.summary, source: row.source, publishedAt: row.at.toISOString(), annotation,
      ...matchSubscription(annotation, profile, input.asOf) };
  });
  const counts = { matched: 0, possible: 0, excluded: 0 };
  for (const item of all) counts[item.lane]++;
  const q = input.q.toLowerCase();
  const view = all.filter(i => (input.lane === "feed" ? i.lane !== "excluded" : i.lane === input.lane) && (!q || `${i.title} ${i.summary ?? ""} ${i.source} ${i.annotation.topics.join(" ")}`.toLowerCase().includes(q)));
  const pageCount = Math.max(1,Math.ceil(view.length/25));
  const page = Math.min(input.page,pageCount);
  return { version: SUBSCRIPTION_TAXONOMY.version, profile, asOf: input.asOf, from: new Date(start.getTime()+8*3600000).toISOString().slice(0,10),
    total: all.length, truncated: rows.length > 5000, counts, items: view.slice((page-1)*25,page*25), page, pageCount,
    quality: { noTopics: all.filter(i=>!i.annotation.topics.length).length,
      unknownAudience: all.filter(i=>i.annotation.warnings.includes("适用对象未明确")).length,
      missingSummary: all.filter(i=>i.annotation.warnings.includes("摘要缺失或不可用")).length } };
}
