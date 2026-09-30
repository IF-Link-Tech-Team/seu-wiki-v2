// 统一搜索里手册/经验这一半：docs 按相关度排（不按时间倒序埋没长文），命中的手册/经验
// 定位到最匹配的章节锚点；经验保留发生年份。类型筛选 type=feed|survival|experience 在路由层拆。
import type { DocSearchHit } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { searchTerms } from "./pool.ts";

interface Row {
  slug: string;
  kind: "survival" | "experience";
  title: string;
  description: string | null;
  occurred_at: string | null;
  headings: Array<{ id: string; text: string; depth: number }>;
  rel: number;
}

/**
 * 相关度：标题命中权重最高，其次正文。条款全部命中才入选（与动态搜索同一口径）。
 * 排序只有相关度（与并列时的发生年份、slug），不含时间衰减——历史长文不该被新内容埋掉。
 */
export async function searchDocs(q: string, kind: "survival" | "experience" | null, limit = 20): Promise<DocSearchHit[]> {
  const terms = searchTerms(q);
  if (!terms.length) return [];
  const match = terms.reduce((acc, t) => sql`${acc} AND d.search_text LIKE ${"%" + t + "%"}`, sql`TRUE`);
  const rel = terms.reduce(
    (acc, t) => sql`${acc} + (CASE WHEN lower(d.title) LIKE ${"%" + t + "%"} THEN 10 ELSE 0 END) + (CASE WHEN lower(coalesce(d.description, '')) LIKE ${"%" + t + "%"} THEN 4 ELSE 0 END)`,
    sql`0`,
  );
  const rows = await sql<Row[]>`
    SELECT d.slug, d.kind, d.title, d.description, d.occurred_at, d.headings, (${rel}) AS rel
    FROM docs d WHERE ${match} ${kind ? sql`AND d.kind = ${kind}` : sql``}
    ORDER BY rel DESC, d.occurred_at DESC NULLS LAST, d.slug LIMIT ${limit}`;
  return rows.map((r) => ({
    slug: r.slug, kind: r.kind, title: r.title, description: r.description, occurredAt: r.occurred_at, anchor: bestAnchor(r, terms),
  }));
}

/** 最匹配的章节：标题文本命中检索词的最深（最具体）一节，返回它的锚点 id。 */
function bestAnchor(r: Pick<Row, "headings" | "title">, terms: string[]): { id: string; text: string } | null {
  let best: { id: string; text: string; score: number } | null = null;
  for (const h of r.headings ?? []) {
    const text = h.text.toLowerCase();
    const hits = terms.filter((t) => text.includes(t)).length;
    if (!hits) continue;
    const score = hits * 10 + h.depth; // 命中词数优先，同级取更深（更具体）的小节
    if (!best || score > best.score) best = { id: h.id, text: h.text, score };
  }
  return best ? { id: best.id, text: best.text } : null;
}
