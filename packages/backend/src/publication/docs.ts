// 知识内容的公开读取层：手册目录树、长文详情（含上/下篇）、经验列表（三维筛选）、旧址映射。
// 数据来自 docs / doc_redirects（导入脚本从 Git 真源生成的派生结果）。
import type { DocDetail, DocHeading, DocSummary, ExperienceIndex, SurvivalPartView } from "@aihot/contracts/site";
import { sql } from "../db.ts";

export interface DocRow {
  id: number;
  slug: string;
  kind: "survival" | "experience";
  title: string;
  description: string | null;
  html: string;
  headings: DocHeading[];
  author: string | null;
  occurred_at: string | null;
  category: string | null;
  grade: string | null;
  college: string | null;
  source_url: string | null;
  part: string | null;
  position: number;
  version: number;
  updated_at: Date;
}

const COLUMNS = sql`id, slug, kind, title, description, html, headings, author, occurred_at, category, grade, college, source_url, part, position, version, updated_at`;

function summary(r: DocRow): DocSummary {
  return {
    slug: r.slug,
    kind: r.kind,
    title: r.title,
    description: r.description,
    author: r.author,
    occurredAt: r.occurred_at,
    category: r.category,
    grade: r.grade,
    college: r.college,
    part: r.part,
    position: r.position,
  };
}

export async function loadDoc(slug: string): Promise<DocDetail | null> {
  const [r] = await sql<DocRow[]>`SELECT ${COLUMNS} FROM docs WHERE slug = ${slug}`;
  if (!r) return null;
  let prev: DocSummary | null = null;
  let next: DocSummary | null = null;
  if (r.part) {
    const [p] = await sql<DocRow[]>`SELECT ${COLUMNS} FROM docs WHERE part = ${r.part} AND position < ${r.position} ORDER BY position DESC LIMIT 1`;
    const [n] = await sql<DocRow[]>`SELECT ${COLUMNS} FROM docs WHERE part = ${r.part} AND position > ${r.position} ORDER BY position LIMIT 1`;
    prev = p ? summary(p) : null;
    next = n ? summary(n) : null;
  }
  return { ...summary(r), html: r.html, headings: r.headings, sourceUrl: r.source_url, prev, next, version: r.version, updatedAt: r.updated_at.toISOString() };
}

const PART_ORDER = ["preface", "viewpoint", "direction", "learning", "life", "alumni", "voices"];

/** 手册目录树：篇 → 组（按 slug 的篇内子目录）→ 条目，条目按目录位置排。 */
export async function loadSurvivalIndex(): Promise<{ parts: SurvivalPartView[] }> {
  const rows = await sql<DocRow[]>`SELECT ${COLUMNS} FROM docs WHERE part IS NOT NULL ORDER BY position`;
  const labels: Record<string, string> = {
    preface: "序言", viewpoint: "观点篇", direction: "方向篇", learning: "学习篇", life: "生活篇", alumni: "校友篇", voices: "我们想对你说",
  };
  const parts: SurvivalPartView[] = [];
  for (const key of PART_ORDER) {
    const entries = rows.filter((r) => r.part === key);
    if (!entries.length) continue;
    // 组：slug 去掉篇前缀后倒数第二段（如 方向篇/求职/5-行业岗位分享/泛it类岗位 下的条目归到 泛it类岗位）。
    const groups = new Map<string, DocSummary[]>();
    for (const r of entries) {
      const segs = r.slug.split("/");
      const group = segs.length > 2 ? segs[segs.length - 2]! : "";
      groups.set(group, [...(groups.get(group) ?? []), summary(r)]);
    }
    parts.push({ key, label: labels[key] ?? key, groups: [...groups.entries()].map(([k, items]) => ({ key: k, items })) });
  }
  return { parts };
}

export interface ExperienceFilter {
  category?: string[];
  grade?: string[];
  college?: string[];
}

export async function loadExperienceIndex(f: ExperienceFilter): Promise<ExperienceIndex> {
  const rows = await sql<DocRow[]>`
    SELECT ${COLUMNS} FROM docs WHERE kind = 'experience'
      AND (${f.category?.length ? f.category : null}::text[] IS NULL OR category IN ${sql(f.category?.length ? f.category : [""])})
      AND (${f.grade?.length ? f.grade : null}::text[] IS NULL OR grade IN ${sql(f.grade?.length ? f.grade : [""])})
      AND (${f.college?.length ? f.college : null}::text[] IS NULL OR college IN ${sql(f.college?.length ? f.college : [""])})
    ORDER BY occurred_at DESC NULLS LAST, position, slug`;
  const all = await sql<{ category: string | null; grade: string | null; college: string | null }[]>`
    SELECT DISTINCT category, grade, college FROM docs WHERE kind = 'experience'`;
  const values = (key: "category" | "grade" | "college") => [...new Set(all.map((r) => r[key]).filter((v): v is string => !!v))].sort();
  return {
    filters: [
      { key: "category", label: "场景", values: values("category") },
      { key: "grade", label: "年级", values: values("grade") },
      { key: "college", label: "学院", values: values("college") },
    ],
    items: rows.map(summary),
  };
}

/** 旧地址 → 新地址（结尾斜杠有无都认）。 */
export async function resolveDocRedirect(pathname: string): Promise<string | null> {
  const normalized = pathname.endsWith("/") ? pathname : `${pathname}/`;
  const [r] = await sql<{ target: string }[]>`SELECT target FROM doc_redirects WHERE old_path IN (${normalized}, ${normalized.replace(/\/$/, "")})`;
  return r?.target ?? null;
}
