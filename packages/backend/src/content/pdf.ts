// PDF bodies: WebPlus 站群的通知经常把全部内容放在一个内嵌 PDF 里（wp_pdf_player 的 pdfsrc），
// 页面本身只有一句"现转发……"；也有条目 URL 直接指向 PDF。PDF 里的文字就是正文。
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { guardedFetch } from "../lib/http-fetch.ts";

const PDF_MAX_BYTES = 20 * 1024 * 1024;
const PDF_MAX_PAGES = 50;
const MIN_PDF_CHARS = 20;

/** pdfsrc 属性（WebPlus 内嵌播放器）和指向 .pdf 的链接/附件。 */
const PDF_REF = /(?:pdfsrc|href|src)=["']([^"']+?\.pdf(?:\?[^"']*)?)["']/gi;

/** PDF references in a page, article embeds first, absolute, deduplicated, at most three. */
export function findPdfUrls(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(PDF_REF)) {
    try {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), baseUrl);
      if (!/^https?:$/.test(u.protocol)) continue;
      if (!out.includes(u.href)) out.push(u.href);
    } catch {
      // not a URL
    }
    if (out.length >= 3) break;
  }
  return out;
}

export function isPdfContent(contentType: string, url: string): boolean {
  return /pdf/i.test(contentType) || /\.pdf(?:\?|$)/i.test(url);
}

interface PdfLine {
  text: string;
  x: number;
  y: number;
  right: number;
  height: number;
  page: number;
}

const SECTION_START = /^(?:[一二三四五六七八九十百]+[、．.]|[（(][一二三四五六七八九十百\d]+[）)]|\d+[、．.)]|第[一二三四五六七八九十百\d]+[章节条])/;

/** Join physical lines without inserting spaces into Chinese words. */
function joinLines(left: string, right: string): string {
  const noSpace = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]$/u.test(left)
    || /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}，。；：！？、）】》]/u.test(right);
  return left + (noSpace ? "" : " ") + right;
}

/** Recover paragraphs from layout rather than treating every printed line as a paragraph. */
function paragraphText(pages: PdfLine[][]): string {
  const paragraphs: string[] = [];
  let previous: PdfLine | undefined;
  for (const lines of pages) {
    const right = Math.max(...lines.map((l) => l.right));
    const gaps = lines.slice(1).map((l, i) => Math.abs(l.y - lines[i]!.y)).filter((g) => g > 0).sort((a, b) => a - b);
    const lineGap = gaps[Math.floor((gaps.length - 1) / 2)] ?? 0;
    for (const line of lines) {
      const samePage = previous?.page === line.page;
      const newParagraph = !previous || SECTION_START.test(line.text)
        || (samePage && (
          line.x - previous.x > line.height * 0.8
          || Math.abs(line.y - previous.y) > Math.max(lineGap * 1.5, line.height * 2.5)
          || Math.abs(line.height - previous.height) > line.height * 0.2
          || (previous.right < right - previous.height * 2 && !/[，、,;；]$/.test(previous.text))
        ))
        || (!samePage && /[。！？.!?：:]$/.test(previous.text));
      if (newParagraph) paragraphs.push(line.text);
      else paragraphs[paragraphs.length - 1] = joinLines(paragraphs.at(-1)!, line.text);
      previous = line;
    }
  }
  return paragraphs.join("\n\n");
}

/** Plain text with blank lines between paragraphs; null for unreadable or image-only PDFs. */
export async function extractPdfText(data: Uint8Array): Promise<string | null> {
  let task: ReturnType<typeof getDocument> | null = null;
  try {
    task = getDocument({ data, disableFontFace: true, useSystemFonts: true });
    const doc = await task.promise;
    const pages: PdfLine[][] = [];
    for (let p = 1; p <= Math.min(doc.numPages, PDF_MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const lines: PdfLine[] = [];
      let line: PdfLine | undefined;
      const flush = () => {
        if (line?.text.trim()) lines.push({ ...line, text: line.text.trim() });
        line = undefined;
      };
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const x = item.transform[4] as number;
        const y = item.transform[5] as number;
        const height = item.height || Math.hypot(item.transform[2], item.transform[3]) || 12;
        // Some PDFs omit hasEOL; a baseline change still identifies a new physical line.
        if (line && Math.abs(line.y - y) > height * 0.5) flush();
        line ??= { text: "", x, y, right: x, height, page: p };
        line.text += item.str;
        line.x = Math.min(line.x, x);
        line.right = Math.max(line.right, x + item.width);
        line.height = Math.max(line.height, height);
        if (item.hasEOL) flush();
      }
      flush();
      const pageHeight = page.view[3] - page.view[1];
      pages.push(lines.filter((l) => !(
        (/^[—–-]\s*\d+\s*[—–-]$/.test(l.text) || l.text === String(p))
        && (l.y < page.view[1] + pageHeight * 0.08 || l.y > page.view[3] - pageHeight * 0.08)
      )));
    }
    const text = paragraphText(pages);
    return text.length >= MIN_PDF_CHARS ? text : null;
  } catch {
    return null;
  } finally {
    await task?.destroy().catch(() => {});
  }
}

/** PDF text as minimal body HTML; sanitizeBody runs on it downstream like any other body. */
export function pdfTextToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((l) => `<p>${esc(l)}</p>`)
    .join("");
}

/** Downloads and reads one PDF; null when it is not a PDF or carries no text. */
export async function fetchPdfText(url: string): Promise<string | null> {
  try {
    const res = await guardedFetch(url, { timeoutMs: 30_000, maxBytes: PDF_MAX_BYTES });
    if (res.status !== 200) return null;
    const head = res.body.subarray(0, 5).toString("latin1");
    if (!isPdfContent(res.headers.get("content-type") ?? "", res.url) && head !== "%PDF-") return null;
    return extractPdfText(new Uint8Array(res.body.buffer, res.body.byteOffset, res.body.byteLength));
  } catch {
    return null;
  }
}
