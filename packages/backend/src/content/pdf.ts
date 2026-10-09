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

/** Plain text of a PDF, one line per text line; null when unreadable or image-only (scanned). */
export async function extractPdfText(data: Uint8Array): Promise<string | null> {
  let task: ReturnType<typeof getDocument> | null = null;
  try {
    task = getDocument({ data, disableFontFace: true, useSystemFonts: true });
    const doc = await task.promise;
    const lines: string[] = [];
    for (let p = 1; p <= Math.min(doc.numPages, PDF_MAX_PAGES); p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line.trim()) lines.push(line);
    }
    const text = lines.map((l) => l.trim()).filter(Boolean).join("\n");
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
    .split("\n")
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
