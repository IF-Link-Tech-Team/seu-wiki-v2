// 把旧站（seu-wiki，Astro/Starlight）的手册与经验内容导入 docs 表。Git 是编辑真源，本脚本
// 幂等可重跑：内容哈希没变就只更新元数据，变了才 bump version。
//
//   node --env-file=.env scripts/import-seuwiki-docs.ts [旧站仓库路径，默认 ../seu-wiki]
//
// 做的事：解析 frontmatter → MDX 安全降级（import/JSX 剥离、:::note 转静态块）→ marked 渲染 →
// sanitize（保留章节锚点）→ 图片复制到 apps/web/public/knowledge-assets/ 并重写引用 →
// 目录顺序取自旧站 src/data/survival.ts（不是文件名字典序）→ 6 个"已迁移"兼容页转为
// doc_redirects 的 301 映射，不重复成两篇。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { closeDb, sql } from "@aihot/backend/db";
import { REPO_ROOT } from "@aihot/backend/config";
import { sha256 } from "@aihot/backend/lib/ids";
import { stripTags } from "@aihot/backend/lib/text";
import { convertDocFull, parseFrontmatter, slugPath } from "@aihot/backend/knowledge/markdown";

const OLD_ROOT = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, "../seu-wiki"));
const DOCS_DIR = path.join(OLD_ROOT, "src/content/docs");
const ASSETS_OUT = path.join(REPO_ROOT, "apps/web/public/knowledge-assets");
const EDIT_BASE = "https://github.com/IF-Link-Tech-Team/seu-wiki/edit/main/src/content/docs/";

interface Scanned {
  file: string;         // 相对 DOCS_DIR 的路径
  slug: string;
  kind: "survival" | "experience";
  raw: string;
}

function walk(dir: string, prefix: string): Scanned[] {
  const out: Scanned[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "assets") continue; // 图片资产目录不是文档
      out.push(...walk(full, `${prefix}${name}/`));
      continue;
    }
    if (!/\.mdx?$/.test(name) || name === "index.mdx" || name === "index.md") continue; // 目录落地页由新站的树页替代
    const rel = `${prefix}${name}`;
    if (!rel.startsWith("survival/") && !rel.startsWith("experience/")) continue; // 顶层 about/contribute/news 是旧站页面，新站有对应入口
    const kind = rel.startsWith("survival/") ? "survival" : "experience";
    out.push({ file: rel, slug: slugPath(rel.replace(/\.mdx?$/, "")), kind, raw: readFileSync(full, "utf8") });
  }
  return out;
}

// 目录顺序来自旧站 src/data/survival.ts（TS，直接 import）。
interface SurvivalPart {
  key: string;
  label: string;
  introEntryId?: string;
  prefix?: string;
  entryBase?: string;
  entryIds?: readonly string[];
  excludedEntryIds?: readonly string[];
}
interface SurvivalDirectory {
  survivalParts: SurvivalPart[];
  getSurvivalPartEntries: <T extends { id: string }>(entries: readonly T[], part: SurvivalPart) => T[];
}
const { survivalParts, getSurvivalPartEntries } = (await import(pathToFileURL(path.join(OLD_ROOT, "src/data/survival.ts")).href)) as SurvivalDirectory;

/** 篇 key 与篇内位置：entryIds 写明的按写明顺序，校友篇按 experience/alumni/ 前缀，其余归篇后按 slug 排。 */
function partAssignments(entries: Array<{ id: string }>): Map<string, { part: string; position: number }> {
  const out = new Map<string, { part: string; position: number }>();
  let offset = 0;
  for (const part of survivalParts) {
    const ids = getSurvivalPartEntries(entries, part).map((e) => e.id);
    const ordered = part.introEntryId ? [part.introEntryId, ...ids.filter((id) => id !== part.introEntryId)] : ids;
    for (const [i, id] of ordered.entries()) if (!out.has(id)) out.set(id, { part: part.key, position: offset + i });
    offset += ordered.length;
  }
  return out;
}

/** "已迁移"兼容页：抽出指向经验库的新地址。 */
function migratedTarget(raw: string): string | null {
  if (!/已迁移/.test(raw)) return null;
  const m = /\]\((\/experience\/[^)\s]+)\)/.exec(raw);
  return m ? m[1]! : null;
}

const scanned = walk(DOCS_DIR, "");
console.log(`扫描到 ${scanned.length} 个文档（目录落地页 index 与 assets 已跳过）`);

mkdirSync(ASSETS_OUT, { recursive: true });
const assetCache = new Map<string, string>();
function resolveImage(fromFile: string) {
  return (src: string): string | null => {
    const abs = path.resolve(path.join(DOCS_DIR, path.dirname(fromFile)), src);
    if (!existsSync(abs)) return null;
    const name = path.basename(abs);
    let target = assetCache.get(abs);
    if (!target) {
      target = `/knowledge-assets/${name}`;
      const out = path.join(ASSETS_OUT, name);
      if (existsSync(out) && sha256(readFileSync(out)) !== sha256(readFileSync(abs))) {
        // 同名不同内容：按内容哈希改名
        const ext = path.extname(name);
        target = `/knowledge-assets/${sha256(readFileSync(abs)).slice(0, 12)}${ext}`;
      }
      copyFileSync(abs, path.join(ASSETS_OUT, path.basename(target)));
      assetCache.set(abs, target);
    }
    return target;
  };
}

const entries = scanned.map((s) => ({ id: s.slug }));
const parts = partAssignments(entries);

// 自校验：survival.ts 里写明的 entryIds 必须都能被 slug 规则覆盖到。
let slugMisses = 0;
for (const part of survivalParts) {
  for (const id of part.entryIds ?? []) {
    if (!entries.some((e) => e.id === id)) {
      console.log(`  ⚠ 目录条目没有对应文件：${id}`);
      slugMisses += 1;
    }
  }
}

let imported = 0;
let unchanged = 0;
let migrated = 0;
let warned = 0;
for (const s of scanned) {
  const compat = migratedTarget(s.raw);
  if (compat) {
    // "已迁移"兼容页：单一正文在经验库，这里只留旧址映射。
    await sql`INSERT INTO doc_redirects (old_path, target) VALUES (${`/${s.slug}/`}, ${compat})
              ON CONFLICT (old_path) DO UPDATE SET target = EXCLUDED.target`;
    migrated += 1;
    continue;
  }
  const { data: fm } = parseFrontmatter(s.raw);
  const title = fm.sidebar?.label ?? fm.title ?? s.slug.split("/").pop()!;
  const r = convertDocFull(s.raw, { resolveImage: resolveImage(s.file), repairStrong: s.file.endsWith(".md") });
  const hash = sha256(r.html);
  const assign = parts.get(s.slug);
  const part = s.kind === "survival" ? (assign?.part ?? null) : s.slug.startsWith("experience/alumni/") ? (assign?.part ?? null) : null;
  const position = assign?.position ?? 0;
  const searchText = `${title} ${fm.description ?? ""} ${r.headings.map((h) => h.text).join(" ")} ${stripTags(r.html)}`.toLowerCase();
  const result = await sql`
    INSERT INTO docs (slug, kind, title, description, html, headings, author, occurred_at, category, grade, college, source_url, part, position, content_hash, search_text)
    VALUES (${s.slug}, ${s.kind}, ${title}, ${fm.description ?? null}, ${r.html}, ${sql.json(r.headings as never)},
            ${fm.author ?? null}, ${fm.occurredAt ?? null}, ${fm.category ?? null}, ${fm.grade ?? null}, ${fm.college ?? null},
            ${fm.source ?? `${EDIT_BASE}${s.file}`}, ${part}, ${position}, ${hash}, ${searchText})
    ON CONFLICT (slug) DO UPDATE SET
      title = EXCLUDED.title, description = EXCLUDED.description, html = EXCLUDED.html, headings = EXCLUDED.headings,
      author = EXCLUDED.author, occurred_at = EXCLUDED.occurred_at, category = EXCLUDED.category, grade = EXCLUDED.grade,
      college = EXCLUDED.college, source_url = EXCLUDED.source_url, part = EXCLUDED.part, position = EXCLUDED.position,
      version = docs.version + (docs.content_hash IS DISTINCT FROM EXCLUDED.content_hash)::int,
      content_hash = EXCLUDED.content_hash, search_text = EXCLUDED.search_text, updated_at = now()
    RETURNING (xmax = 0) AS inserted, (version = 1 AND xmax <> 0) AS kept`;
  if (result[0]!.inserted) imported += 1;
  else unchanged += 1;
  if (r.warnings.length) {
    warned += 1;
    console.log(`  ⚠ ${s.file}: ${r.warnings.join("; ")}`);
  }
}

console.log(`导入报告：新增/更新 ${imported}，重跑未变 ${unchanged}，"已迁移"兼容页→301 ${migrated}，有警告 ${warned}，目录自检缺失 ${slugMisses}`);
await closeDb();
