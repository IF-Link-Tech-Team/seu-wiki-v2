// 旧站 Markdown/MDX → 静态 HTML 的转换（知识内容导入用）。绝不把 Markdown 当可执行 MDX 运行：
// import/export 行和 JSX 组件一律剥离并计数告警；:::note 提示块转成静态 <aside>；图片相对路径
// 由调用方给的 resolveImage 重写。加粗边界（**中文**后文）沿用旧站 repair-survival-strong 的修法。
import * as cheerio from "cheerio";
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

export interface DocFrontmatter {
  title?: string;
  description?: string;
  sidebar?: { label?: string; order?: number; hidden?: boolean };
  category?: string;
  grade?: string;
  college?: string;
  occurredAt?: string;
  source?: string;
  author?: string;
  [key: string]: unknown;
}

/** 这几个文件 frontmatter 的写法很简单（key: value，sidebar 一层缩进），一个小解析器就够。 */
export function parseFrontmatter(raw: string): { data: DocFrontmatter; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };
  const data: DocFrontmatter = {};
  let section: string | null = null;
  for (const line of m[1]!.split("\n")) {
    const nested = /^ {2}(\w[\w-]*):\s*(.*)$/.exec(line);
    const top = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (nested && section) {
      if (section === "sidebar") {
        data.sidebar ??= {};
        const v = scalar(nested[2]!);
        if (nested[1] === "label") data.sidebar.label = v ?? undefined;
        if (nested[1] === "order") data.sidebar.order = Number(v);
        if (nested[1] === "hidden") data.sidebar.hidden = v === "true";
      }
      continue;
    }
    if (top) {
      section = top[1]!;
      const v = scalar(top[2]!);
      if (v !== null) (data as Record<string, unknown>)[top[1]!] = v;
    }
  }
  return { data, body: raw.slice(m[0].length) };
}

function scalar(v: string): string | null {
  const t = v.trim();
  if (!t) return null;
  const q = /^'(.*)'$/.exec(t) ?? /^"(.*)"$/.exec(t);
  return (q ? q[1]! : t).trim() || null;
}

/** Starlight 的路径段规则：ASCII 小写、空格转连字符、去掉标点（保留中日韩文字、数字、- _）。 */
export function slugSegment(segment: string): string {
  return segment
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_一-鿿-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-|-$/g, "");
}

/** 文件相对路径（去扩展名）→ 站内外一致的 slug，如 'survival/方向篇/升学/1-保研篇'。 */
export function slugPath(relativePathNoExt: string): string {
  return relativePathNoExt.split("/").map(slugSegment).filter(Boolean).join("/");
}

/** 标题的章节锚点 id（文中已有的 <span id> 优先，标题 id 只是补充定位）。 */
export function headingId(text: string): string {
  return slugSegment(text) || "section";
}

/**
 * 旧式加粗修复（seu-wiki/src/repair-survival-strong.mjs 的同款扫描）：
 * `**中文标点**后文` 这类边界 CommonMark 不认，扫描器把成对的 ** 换成 <strong>，代码段不动。
 */
export function repairStrongMarkers(source: string): string {
  const countRun = (start: number, character: string) => {
    let end = start;
    while (source[end] === character) end += 1;
    return end - start;
  };
  let output = "";
  let strongOpen = false;
  let codeTicks = 0;
  for (let index = 0; index < source.length; ) {
    const ch = source[index]!;
    if (ch === "`") {
      const run = countRun(index, "`");
      output += source.slice(index, index + run);
      codeTicks = codeTicks === 0 ? run : codeTicks === run ? 0 : codeTicks;
      index += run;
      continue;
    }
    if (ch !== "*" || codeTicks !== 0) {
      output += ch;
      index += 1;
      continue;
    }
    const run = countRun(index, "*");
    if (run !== 2 && run !== 4) {
      output += source.slice(index, index + run);
      index += run;
      continue;
    }
    const end = index + run;
    const contentAfter = source.slice(end).trim().length > 0;
    if (run === 2) {
      if (strongOpen) {
        output += "</strong>";
        strongOpen = false;
      } else if (contentAfter) {
        output += "<strong>";
        strongOpen = true;
      }
    } else if (strongOpen) {
      output += contentAfter ? "</strong><strong>" : "</strong>";
      strongOpen = contentAfter;
    } else if (contentAfter) {
      output += "<strong>";
      strongOpen = true;
    }
    index = end;
  }
  if (strongOpen) output += "</strong>";
  return output;
}

export interface ConvertResult {
  html: string;
  headings: Array<{ id: string; text: string; depth: number }>;
  warnings: string[];
}

const NOTE_KINDS = new Set(["note", "tip", "caution", "danger", "important"]);

export interface ConvertOptions {
  /** 图片相对路径 → 站内 URL；返回 null 表示图片缺失（保留原引用并告警）。 */
  resolveImage?: (src: string) => string | null;
  /** 旧式 .md 文件（非 .mdx）跑加粗边界修复。 */
  repairStrong?: boolean;
}

export function convertDoc(raw: string, opts: ConvertOptions = {}): ConvertResult {
  const warnings: string[] = [];
  let body = parseFrontmatter(raw).body;
  if (opts.repairStrong && body.includes("**")) body = repairStrongMarkers(body);

  // MDX 的 import/export：组件不会被执行，引用它们的标签下面剥掉。
  const mdxLines = body.match(/^ *(?:import|export)\s.+$/gm);
  if (mdxLines?.length) {
    warnings.push(`stripped ${mdxLines.length} mdx import/export line(s)`);
    body = body.replace(/^ *(?:import|export)\s.+$/gm, "");
  }

  // Starlight 提示块 :::note[标题] … ::: → 静态 <aside>（内容仍按 Markdown 渲染）。
  body = body.replace(/^:::(\w+)(?:\[([^\]]*)\])?\s*\n([\s\S]*?)^:::\s*$/gm, (_m, kind: string, title: string | undefined, inner: string) => {
    const k = NOTE_KINDS.has(kind) ? kind : "note";
    const innerHtml = marked.parse(inner.trim(), { async: false }) as string;
    return `<aside class="doc-note doc-note-${k}"><p class="doc-note-title">${escapeHtml(title?.trim() || ({ note: "备注", tip: "提示", caution: "注意", danger: "警告", important: "重要" } as Record<string, string>)[k]!)}</p>${innerHtml}</aside>`;
  });

  // JSX 组件（大写开头）：自闭合直接移除，成对的保留内部文本。
  const jsx = body.match(/<\/?[A-Z][A-Za-z0-9.]*(\s[^<>]*)?\s*\/?>/g);
  if (jsx?.length) {
    warnings.push(`stripped ${jsx.length} jsx component tag(s): ${[...new Set(jsx.map((t) => /^<\/?([\w.]+)/.exec(t)![1]!))].join(", ")}`);
    body = body.replace(/<\/?[A-Z][A-Za-z0-9.]*(\s[^<>]*)?\s*\/?>/g, "");
  }

  // 图片：Markdown 写法与 inline HTML 的相对路径都重写。
  if (opts.resolveImage) {
    const resolve = opts.resolveImage;
    body = body.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt: string, src: string) => {
      if (/^(https?:|data:|\/)/.test(src)) return m;
      const next = resolve(src);
      if (next === null) warnings.push(`missing image: ${src}`);
      return `![${alt}](${next ?? src})`;
    });
    body = body.replace(/<img\b([^>]*?)\bsrc="([^"]+)"([^>]*)>/gi, (m, pre: string, src: string, post: string) => {
      if (/^(https?:|data:|\/)/.test(src)) return m;
      const next = resolve(src);
      if (next === null) warnings.push(`missing image: ${src}`);
      return `<img${pre}src="${next ?? src}"${post}>`;
    });
  }

  const html = marked.parse(body, { async: false, gfm: true }) as string;
  return { html: sanitizeDocHtml(html, warnings), headings: headingsOf(html), warnings };
}

function headingsOf(html: string): Array<{ id: string; text: string; depth: number }> {
  const $ = cheerio.load(html, null, false);
  const seen = new Map<string, number>();
  const out: Array<{ id: string; text: string; depth: number }> = [];
  $("h1, h2, h3, h4").each((_, el) => {
    const depth = Number(el.tagName.slice(1));
    const text = $(el).text().trim();
    if (!text) return;
    let id = headingId(text);
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    if (n > 0) id = `${id}-${n}`;
    out.push({ id, text, depth });
  });
  return out;
}

/** 给没有 id 的标题补上锚点 id。 */
function withHeadingIds(html: string, headings: Array<{ id: string; text: string; depth: number }>): string {
  if (!headings.length) return html;
  const $ = cheerio.load(html, null, false);
  let i = 0;
  $("h1, h2, h3, h4").each((_, el) => {
    const h = headings[i++];
    if (h && !$(el).attr("id")) $(el).attr("id", h.id);
  });
  return $.html();
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 长文档的 sanitize 配置：保留章节锚点（标题 id、<span id>）与提示块，其余与正文白名单同级。 */
function sanitizeDocHtml(html: string, warnings: string[]): string {
  const cleaned = sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "ul", "ol", "li", "blockquote", "pre", "code", "table", "thead", "tbody",
      "tr", "th", "td", "caption", "a", "img", "figure", "figcaption", "strong", "em", "b", "i", "u", "s", "del",
      "sup", "sub", "mark", "span", "aside", "dl", "dt", "dd",
    ],
    nonTextTags: ["script", "style", "noscript", "iframe", "object", "embed", "form", "input", "button", "svg", "template"],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "width", "height", "title"],
      code: ["class"],
      pre: ["class"],
      span: ["id", "aria-hidden"],
      h1: ["id"], h2: ["id"], h3: ["id"], h4: ["id"], h5: ["id"],
      aside: ["class"],
      th: ["colspan", "rowspan", "align"],
      td: ["colspan", "rowspan", "align"],
    },
    allowedClasses: { aside: [/^doc-note(?:-(?:note|tip|caution|danger|important))?$/], p: ["doc-note-title"], code: [/^language-[\w-]+$/], pre: [/^language-[\w-]+$/] },
    allowedSchemes: ["http", "https"],
    allowProtocolRelative: false,
  });
  if (/<(script|iframe|form)\b/i.test(html) && !/<(script|iframe|form)\b/i.test(cleaned)) warnings.push("stripped active markup (script/iframe/form)");
  return cleaned;
}

/** 完整转换：sanitize 之后补标题锚点。 */
export function convertDocFull(raw: string, opts: ConvertOptions = {}): ConvertResult {
  const r = convertDoc(raw, opts);
  return { ...r, html: withHeadingIds(r.html, r.headings) };
}
