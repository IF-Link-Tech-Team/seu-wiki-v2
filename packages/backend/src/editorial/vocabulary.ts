// Tag normalization over the industry pack's vocabulary (industry/taxonomy.ts), which the topics
// (industry/topics.json) are built on. 主题词的运行时词表在 taxonomy_terms 表（taxonomy/terms.ts）：
// 词表缓存温热后（runStructure 每次都会先取），normalizeTags 认 DB 里的新词并把别名归一到主词。
import { CATEGORIES, CATEGORY_TAGS, ENTITY_TAGS, TAG_SYNONYMS, TOPIC_TAGS } from "@aihot/industry/taxonomy";
import { canonicalTag, type RuntimeTaxonomy } from "../taxonomy/terms.ts";

export { CATEGORY_BY_ITEM_TYPE, CATEGORY_TAGS, ENTITIES, ENTITY_TAGS, ITEM_TYPES, TOPIC_TAGS } from "@aihot/industry/taxonomy";

const STATIC_ALLOWED = new Set<string>([...CATEGORY_TAGS, ...TOPIC_TAGS, ...ENTITY_TAGS]);

/** 最近一次读到的运行时词表（taxonomy/terms.ts 的 60s 缓存值）；没读到就用种子。 */
let runtime: RuntimeTaxonomy | null = null;
export function warmTagVocabulary(tax: RuntimeTaxonomy) {
  runtime = tax;
}

/**
 * Known tags only, synonyms mapped, duplicates dropped, at most `max`; the category tag goes first. A list
 * without one gets `fallbackCategory` (deterministic, no repair call).
 */
export function normalizeTags(v: unknown, opts: { max?: number; fallbackCategory?: string } = {}): string[] {
  const max = opts.max ?? 6;
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,，]/g) : [];
  const allowed = new Set([...STATIC_ALLOWED, ...(runtime?.active ?? [])]);
  const tags: string[] = [];
  for (const x of raw) {
    const t = String(x ?? "").trim().replace(/^#/, "");
    const tag = TAG_SYNONYMS[t] ?? TAG_SYNONYMS[t.toLowerCase()] ?? (runtime ? canonicalTag(t, runtime) : t);
    if (tag && allowed.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  const isCategory = (t: string) => (CATEGORY_TAGS as readonly string[]).includes(t);
  const categoryIndex = tags.findIndex(isCategory);
  const category = categoryIndex >= 0 ? tags[categoryIndex]! : (opts.fallbackCategory ?? CATEGORY_TAGS[CATEGORY_TAGS.length - 1]!);
  return [category, ...tags.filter((t) => t !== category)].slice(0, max);
}

/** The category guide the structure step reads: one line per category. */
export const CATEGORY_GUIDE = CATEGORIES.map((c) => `- ${c.key}（${c.label}）：${c.guide}`).join("\n");
