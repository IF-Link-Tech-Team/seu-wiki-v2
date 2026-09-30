// 「为你」信息流：个性化只做加权和标注，不做剔除。流里包含全部公开内容，命中画像的卡片上浮并
// 带理由 chip，没命中的按自身价值正常排。画像是查询参数，匿名和未填的维度一律中性（不加不减）。
//
// 排序分 = 基础分 × 时效系数 + 匹配加成（封顶 40），全部在 SQL 里完成：
//   基础分      publications.score，null 按 50 计
//   时效系数    campus->deadline 还在未来（仍在报名/办理期）为 1；否则按 published_at 距今天数
//               衰减：7 天内为 1，之后每 7 天 ×0.85，下限 0.3
//   匹配加成    学院命中 +30、学历命中 +15、年级命中 +10、兴趣主题命中 +10（标签 ∩ 兴趣）、
//               关注组织命中 +30，累加后 LEAST(40, …)。「全校」是中性：campus.colleges 为空数组
//               或含「全校」时不加学院分。
import type { CategoryKey } from "@aihot/contracts/taxonomy";
import type { ForYouItem, ForYouProfile, ForYouResponse } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { decodeCursor, encodeCursor, InvalidCursorError, queryBinding } from "../lib/cursor.ts";
import { categoryCondition, ITEM_COLUMNS, ITEM_FROM, listedCondition, toFeedItemSummary, type ItemRow } from "./items.ts";
import { canonicalTag, getTaxonomyTerms } from "../taxonomy/terms.ts";

const DEGREES = new Set(["本科", "硕士", "博士"]);

function splitList(value: string | undefined): string[] {
  return (value ?? "").split(",").map((s) => s.trim().slice(0, 30)).filter(Boolean).slice(0, 10);
}

/** 查询参数 → 画像。未知的学历档位直接忽略（中性），其余字段截断后原样使用。 */
export function parseForYouProfile(q: Record<string, string | undefined>): ForYouProfile {
  const college = q.college?.trim().slice(0, 40) || null;
  const degreeRaw = q.degree?.trim() || null;
  const degree = degreeRaw && DEGREES.has(degreeRaw) ? degreeRaw : null;
  const grade = q.grade?.trim().slice(0, 20) || null;
  return { college, degree, grade, interests: splitList(q.interests), orgs: splitList(q.orgs) };
}

export interface ForYouQuery {
  profile: ForYouProfile;
  category?: CategoryKey | null;
  cursor?: string | null;
  limit?: number;
  now?: Date;
}

type RankedRow = ItemRow & { rank_score: number | string; match_reasons: string[] | null };

export async function loadForYou(q: ForYouQuery): Promise<ForYouResponse> {
  const now = q.now ?? new Date();
  const limit = Math.min(Math.max(q.limit ?? 20, 1), 40);
  const college = q.profile.college ?? null;
  const degree = q.profile.degree ?? null;
  const grade = q.profile.grade ?? null;
  // 兴趣词认别名：画像里的词归一到主词，再扩展出它的全部别名，旧内容上的别名标签也命中。
  const tax = await getTaxonomyTerms();
  const interests = [...new Set((q.profile.interests ?? []).flatMap((i) => {
    const canonical = canonicalTag(i, tax);
    return [canonical, ...(tax.aliasesOf[canonical] ?? [])];
  }))];
  const orgs = q.profile.orgs ?? [];
  // 组织标签在 publications.tags 里以 entity:<id> 收纳（见 publish.ts），关注组织两种写法都认。
  const orgCandidates = [...new Set(orgs.flatMap((o) => [o, `entity:${o}`]))];

  const bind = queryBinding({ c: college, d: degree, g: grade, i: interests, o: orgs, k: q.category ?? null });
  let after: { s: number; t: string; i: string } | null = null;
  if (q.cursor) {
    const c = decodeCursor<{ s: number; t: string; i: string; b: string }>("fy1", q.cursor);
    if (c.b !== bind || typeof c.s !== "number" || typeof c.t !== "string" || typeof c.i !== "string") {
      throw new InvalidCursorError("cursor does not match this query");
    }
    after = c;
  }

  const rows = await sql<RankedRow[]>`
    WITH scored AS MATERIALIZED (
      SELECT p.article_id, p.timeline_at,
        coalesce(p.score, 50) * (
          CASE WHEN p.campus->>'deadline' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND (p.campus->>'deadline')::timestamptz > ${now}
            THEN 1
            ELSE greatest(0.3, power(0.85, floor(extract(epoch from (${now}::timestamptz - coalesce(p.published_at, p.discovered_at))) / 86400 / 7)))
          END) AS base_score,
        (CASE WHEN ${college}::text IS NOT NULL AND jsonb_typeof(p.campus->'colleges') = 'array'
            AND p.campus->'colleges' <> '[]'::jsonb AND NOT (p.campus->'colleges' @> '["全校"]')
            AND p.campus->'colleges' ? ${college}
          THEN 30 ELSE 0 END
        + CASE WHEN ${degree}::text IS NOT NULL AND jsonb_typeof(p.campus->'identities') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.campus->'identities') i WHERE i LIKE '%' || ${degree} || '%')
          THEN 15 ELSE 0 END
        + CASE WHEN ${grade}::text IS NOT NULL AND jsonb_typeof(p.campus->'grades') = 'array' AND p.campus->'grades' ? ${grade}
          THEN 10 ELSE 0 END
        + CASE WHEN p.tags && ${interests}::text[] THEN 10 ELSE 0 END
        + CASE WHEN p.tags && ${orgCandidates}::text[] THEN 30 ELSE 0 END
        ) AS bonus,
        (SELECT coalesce(array_agg(r), '{}') FROM (
          SELECT ${college} AS r WHERE ${college}::text IS NOT NULL AND jsonb_typeof(p.campus->'colleges') = 'array'
            AND p.campus->'colleges' <> '[]'::jsonb AND NOT (p.campus->'colleges' @> '["全校"]')
            AND p.campus->'colleges' ? ${college}
          UNION ALL SELECT ${degree} || '生' WHERE ${degree}::text IS NOT NULL AND jsonb_typeof(p.campus->'identities') = 'array'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements_text(p.campus->'identities') i WHERE i LIKE '%' || ${degree} || '%')
          UNION ALL SELECT ${grade} WHERE ${grade}::text IS NOT NULL AND jsonb_typeof(p.campus->'grades') = 'array' AND p.campus->'grades' ? ${grade}
          UNION ALL SELECT t FROM unnest(p.tags) t WHERE t = ANY (${interests}::text[])
          UNION ALL SELECT o FROM unnest(${orgs}::text[]) o WHERE p.tags && ARRAY[o, 'entity:' || o]
        ) reasons) AS match_reasons
      FROM publications p
      WHERE ${listedCondition(now)} AND p.eligible ${categoryCondition(q.category)}
    ), page AS MATERIALIZED (
      SELECT article_id, timeline_at, (base_score + least(40, bonus)) AS rank_score, match_reasons FROM scored
      ${after ? sql`WHERE (base_score + least(40, bonus), timeline_at, article_id) < (${after.s}::numeric, ${after.t}::timestamptz, ${after.i})` : sql``}
      ORDER BY rank_score DESC, timeline_at DESC, article_id DESC LIMIT ${limit + 1}
    )
    SELECT ${ITEM_COLUMNS}, page.rank_score, page.match_reasons ${ITEM_FROM} JOIN page ON page.article_id = p.article_id
    ORDER BY page.rank_score DESC, page.timeline_at DESC, page.article_id DESC`;

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const items: ForYouItem[] = page.map((row) => ({
    ...toFeedItemSummary(row),
    matchReasons: row.match_reasons ?? [],
    rankScore: Math.round(Number(row.rank_score) * 100) / 100,
  }));
  const last = page[page.length - 1];
  const nextCursor = hasMore && last
    ? encodeCursor("fy1", { s: Number(last.rank_score), t: last.timeline_at.toISOString(), i: last.id, b: bind })
    : null;
  return { profile: q.profile, items, nextCursor, generatedAt: now.toISOString() };
}
