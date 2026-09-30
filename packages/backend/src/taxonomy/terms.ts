// 运行时兴趣词表（决策 13.6）：taxonomy_terms 表是准，industry/taxonomy.ts 的 TOPIC_GROUPS 是种子
// 和空表兜底。读取带 60s 缓存；候选池三个入口（模型 suggestedTopic / 组织投稿 / 管理员手动加）；
// 批准和设别名都会排一个回填任务（jobs/taxonomy.ts）。
import { TOPIC_GROUPS } from "@aihot/industry/taxonomy";
import { sql, type Db } from "../db.ts";
import { audit } from "../admin/auth.ts";
import { enqueue, QUEUES } from "../jobs/queue.ts";

/** 一个词值得进词表的标准（也写在后台词表页的提示里）：预期每月相关内容 ≥3 条且有跨来源复用价值。 */
export const TERM_GRANULARITY_GUIDE = "一个词值得进词表的标准：预期每月相关内容 ≥3 条，且有跨来源复用价值（不是一个活动的一次性名字）。";
/** 候选进审核队列的提议次数门槛。 */
export const CANDIDATE_THRESHOLD = 3;

export interface TaxonomyTerm {
  id: number;
  grp: string;
  name: string;
  aliases: string[];
  status: "active" | "candidate" | "rejected";
  source: "seed" | "model" | "org" | "admin";
  count: number;
  examples: string[];
}

/** 种子导入（启动时跑，幂等）：TOPIC_GROUPS 落为 active 词。 */
export async function seedTaxonomyTerms(db: Db = sql): Promise<number> {
  let n = 0;
  for (const g of TOPIC_GROUPS) {
    for (const name of g.terms) {
      const r = await db`INSERT INTO taxonomy_terms (grp, name, status, source) VALUES (${g.label}, ${name}, 'active', 'seed') ON CONFLICT (name) DO NOTHING`;
      n += r.count;
    }
  }
  return n;
}

export interface RuntimeTaxonomy {
  /** active 主词（供提示词注入和画像 chip）。 */
  active: string[];
  /** 别名（含大小写无关的写法）→ 主词。 */
  aliasOf: Record<string, string>;
  /** 主词 → 全部别名（匹配时扩展用）。 */
  aliasesOf: Record<string, string[]>;
}

const FALLBACK: RuntimeTaxonomy = {
  active: TOPIC_GROUPS.flatMap((g) => [...g.terms]),
  aliasOf: {},
  aliasesOf: {},
};

let cache: { at: number; value: RuntimeTaxonomy } | null = null;

/** 运行时词表：active 词 + 别名映射，60s 缓存；表为空/读失败时用种子兜底。 */
export async function getTaxonomyTerms(): Promise<RuntimeTaxonomy> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  try {
    const rows = await sql<{ name: string; aliases: string[] }[]>`SELECT name, aliases FROM taxonomy_terms WHERE status = 'active'`;
    if (!rows.length) return FALLBACK;
    const aliasOf: Record<string, string> = {};
    const aliasesOf: Record<string, string[]> = {};
    for (const r of rows) {
      aliasesOf[r.name] = r.aliases;
      for (const a of r.aliases) aliasOf[a] = r.name;
    }
    cache = { at: Date.now(), value: { active: rows.map((r) => r.name), aliasOf, aliasesOf } };
    return cache.value;
  } catch {
    return cache?.value ?? FALLBACK;
  }
}

/** 匹配/展示时归一：别名（或大小写写法）归到主词；不认识的原样返回。 */
export function canonicalTag(name: string, tax: RuntimeTaxonomy): string {
  return tax.aliasOf[name] ?? tax.aliasOf[name.toLowerCase()] ?? name;
}

// ---------------------------------------------------------------------------
// 候选池
// ---------------------------------------------------------------------------

/**
 * 提议一个词进候选池：已是 active 或某词的别名 → 不动（该词已被覆盖）；在 rejected → 不再进；
 * 否则同名词 count+1 并记住示例链接。count ≥ 3 才出现在审核队列。
 */
export async function recordCandidate(rawName: unknown, source: "model" | "org", example?: string | null): Promise<void> {
  const name = String(rawName ?? "").trim().replace(/^#/, "").slice(0, 30);
  if (!name || name.length < 2) return;
  const tax = await getTaxonomyTerms();
  if (tax.active.includes(name) || tax.aliasOf[name] || tax.aliasOf[name.toLowerCase()]) return;
  const [existing] = await sql<{ status: string }[]>`SELECT status FROM taxonomy_terms WHERE name = ${name}`;
  if (existing?.status === "rejected") return;
  const ex = example ? [example] : null; // postgres.js 把空数组序列化成 NULL，用 COALESCE 兜底
  await sql`
    INSERT INTO taxonomy_terms (grp, name, status, source, count, examples)
    VALUES ('', ${name}, 'candidate', ${source}, 1, COALESCE(${ex}::text[], '{}'))
    ON CONFLICT (name) DO UPDATE SET
      count = taxonomy_terms.count + 1,
      examples = COALESCE((SELECT array_agg(e) FROM (SELECT DISTINCT e FROM unnest(taxonomy_terms.examples || COALESCE(${ex}::text[], '{}')) e ORDER BY e DESC LIMIT 5) t), '{}'),
      updated_at = now()`;
}

// ---------------------------------------------------------------------------
// 审核（后台 /admin/taxonomy）
// ---------------------------------------------------------------------------

export async function listTaxonomy(): Promise<{ terms: TaxonomyTerm[]; candidates: TaxonomyTerm[] }> {
  const terms = await sql<TaxonomyTerm[]>`SELECT * FROM taxonomy_terms WHERE status = 'active' ORDER BY grp, id`;
  const candidates = await sql<TaxonomyTerm[]>`SELECT * FROM taxonomy_terms WHERE status = 'candidate' AND count >= ${CANDIDATE_THRESHOLD} ORDER BY count DESC, updated_at DESC LIMIT 100`;
  return { terms, candidates };
}

/** 批准：选分组转 active，排回填任务。 */
export async function approveTerm(id: number, grp: string, actor: string) {
  const group = TOPIC_GROUPS.find((g) => g.label === grp)?.label;
  if (!group) throw Object.assign(new Error("未知的分组"), { statusCode: 400 });
  const [t] = await sql<TaxonomyTerm[]>`UPDATE taxonomy_terms SET status = 'active', grp = ${group}, reviewed_by = ${actor}, reviewed_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'candidate' RETURNING *`;
  if (!t) throw Object.assign(new Error("候选不存在或已处理"), { statusCode: 404 });
  await enqueue(QUEUES.taxonomyBackfill, { termId: t.id, term: t.name, aliases: [] }, { singletonKey: `taxonomy-backfill:${t.id}` });
  await audit(actor, "taxonomy.approve", `taxonomy:${id}`, null, { status: "candidate" }, { status: "active", grp: group });
  cache = null;
  return t;
}

/** 设为别名：候选词归到现有主词（匹配时归一），候选行转 rejected 留档（别名检查在前，它不会再进候选池）。 */
export async function aliasTerm(id: number, targetName: string, actor: string) {
  const [target] = await sql<TaxonomyTerm[]>`SELECT * FROM taxonomy_terms WHERE name = ${targetName} AND status = 'active'`;
  if (!target) throw Object.assign(new Error("目标词不存在或不在词表"), { statusCode: 400 });
  const [t] = await sql<TaxonomyTerm[]>`UPDATE taxonomy_terms SET status = 'rejected', reviewed_by = ${actor}, reviewed_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'candidate' RETURNING *`;
  if (!t) throw Object.assign(new Error("候选不存在或已处理"), { statusCode: 404 });
  await sql`UPDATE taxonomy_terms SET aliases = (SELECT array_agg(DISTINCT a) FROM unnest(aliases || ${[t.name]}::text[]) a), updated_at = now() WHERE id = ${target.id}`;
  await enqueue(QUEUES.taxonomyBackfill, { termId: target.id, term: target.name, aliases: [t.name] }, { singletonKey: `taxonomy-backfill:${target.id}` });
  await audit(actor, "taxonomy.alias", `taxonomy:${id}`, null, { name: t.name }, { aliasOf: target.name });
  cache = null;
  return { alias: t.name, target: target.name };
}

/** 拒绝：进 rejected，同词不再进候选池。 */
export async function rejectTerm(id: number, actor: string) {
  const [t] = await sql<TaxonomyTerm[]>`UPDATE taxonomy_terms SET status = 'rejected', reviewed_by = ${actor}, reviewed_at = now(), updated_at = now()
    WHERE id = ${id} AND status = 'candidate' RETURNING *`;
  if (!t) throw Object.assign(new Error("候选不存在或已处理"), { statusCode: 404 });
  await audit(actor, "taxonomy.reject", `taxonomy:${id}`, null, { status: "candidate" }, { status: "rejected" });
  return t;
}

/** 管理员手动加：直接 active。 */
export async function addTerm(name: unknown, grp: string, actor: string) {
  const group = TOPIC_GROUPS.find((g) => g.label === grp)?.label;
  if (!group) throw Object.assign(new Error("未知的分组"), { statusCode: 400 });
  const n = String(name ?? "").trim().slice(0, 30);
  if (n.length < 2) throw Object.assign(new Error("词太短"), { statusCode: 400 });
  const [t] = await sql<TaxonomyTerm[]>`
    INSERT INTO taxonomy_terms (grp, name, status, source) VALUES (${group}, ${n}, 'active', 'admin')
    ON CONFLICT (name) DO UPDATE SET status = 'active', grp = EXCLUDED.grp, reviewed_by = ${actor}, reviewed_at = now(), updated_at = now()
    RETURNING *`;
  await audit(actor, "taxonomy.add", `taxonomy:${t!.id}`, null, null, { name: n, grp: group });
  cache = null;
  return t;
}
