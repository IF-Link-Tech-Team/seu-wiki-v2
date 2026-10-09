// PDF 正文与薄正文条目：正文只有内嵌 PDF（wp_pdf_player）或附件链接的页面，PDF 的文字并入正文；
// 直接指向 PDF 的条目 URL 也可读。抽不到正文的条目拿如实占位摘要（NO_BODY_SUMMARY），进列表和
// 搜索，但不凭标题进精选。
import { stub, tag } from "./setup.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { extractFromUrl } from "@aihot/backend/content/extract";
import { findPdfUrls } from "@aihot/backend/content/pdf";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle, NO_BODY_SUMMARY } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";
import { loadPool } from "@aihot/backend/publication/pool";

const T = tag();
const SOURCE = `test-pdf-${T}`;
const PDF_LINE1 = `PDFBODYMARKER${T} attachment notice`;
const PDF_LINE2 = `SECONDLINE${T} closing`;

/** 最小合法单页 PDF（不压缩的文本流；长单行会被 pdfjs 按页面宽度截断，所以用两行短文本）。 */
function makePdf(line1: string, line2: string): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${line1}) Tj 0 -20 Td (${line2}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

const pdf = makePdf(PDF_LINE1, PDF_LINE2);
const wpPage = (inner: string) => `<html><head><title>t</title></head><body><div class="wp_articlecontent">${inner}</div></body></html>`;
const pages: Record<string, { type: string; body: string | Buffer }> = {
  // 正文区只有内嵌 PDF 播放器（pdfsrc 相对路径）
  [`/p/player-${T}`]: { type: "text/html", body: wpPage(`<p><span class="wp_pdf_player" pdfsrc="/files/n-${T}.pdf"></span></p>`) },
  // 一句转发语 + 附件 PDF 链接：两者应合并成正文
  [`/p/thin-${T}`]: { type: "text/html", body: wpPage(`<p>现转发一项通知${T}，请查收。</p><p><a href="/files/a-${T}.pdf">附件：通知.pdf</a></p>`) },
  // 无 PDF 的空正文区：仍然抽不出来
  [`/p/empty-${T}`]: { type: "text/html", body: wpPage(`<p><span class="wp_pdf_player"></span></p>`) },
  [`/files/n-${T}.pdf`]: { type: "application/pdf", body: pdf },
  [`/files/a-${T}.pdf`]: { type: "application/octet-stream", body: pdf },
  [`/direct-${T}.pdf`]: { type: "application/pdf", body: pdf },
};

const server = http.createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  const page = pages[path];
  if (!page) {
    res.writeHead(404).end("nope");
    return;
  }
  res.writeHead(200, { "content-type": page.type });
  res.end(page.body);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
config.allowPrivateNetworkFetch = true;

const provider = await stub((_hit, req) => {
  const body = JSON.parse(req.body) as { messages: Array<{ role: string; content: unknown }> };
  const system = body.messages[0]!.role === "system" ? String(body.messages[0]!.content) : "";
  const answer = (content: unknown) => ({ id: "stub", model: "stub", choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
  if (system.includes("宽召回的校园相关性预筛")) return answer({ label: "PASS", reason: "测试" });
  if (system.includes("事件注意力评分器")) return answer({ attentionScore: 5 });
  if (system.includes("资料结构化助手")) {
    return answer({
      category: "academic", tags: ["教务通知"], subjects: ["jwc"],
      fact: { title: "事实", subject: "教务处", action: "发布", object: "通知", occurredAt: null },
    });
  }
  throw new Error(`薄正文条目不应触发写作模型调用: ${system.slice(0, 30)}`);
});
for (const env of ["DASHSCOPE_BASE_URL", "ZHIPU_BASE_URL", "DEEPSEEK_BASE_URL"]) process.env[env] = `${provider.url}/v1`;
for (const env of ["DASHSCOPE_API_KEY", "ZHIPU_API_KEY", "DEEPSEEK_API_KEY"]) process.env[env] = "test-key";

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, site_fulltext, next_fetch_at)
            VALUES (${SOURCE}, 'Test pdf source', 'web_list', 'T1', 'editorial', true, '2100-01-01')`;
});
after(async () => {
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await provider.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await stopBoss();
  await closeDb();
});

test("findPdfUrls：pdfsrc 与附件链接、相对路径解析、去重", () => {
  const html = `<span class="wp_pdf_player" pdfsrc="/u/a.pdf"></span><a href="/u/a.pdf">a</a><a href="https://x.test/b.pdf?x=1">b</a><a href="/u/c.docx">c</a>`;
  assert.deepEqual(findPdfUrls(html, "https://site.test/p/1"), ["https://site.test/u/a.pdf", "https://x.test/b.pdf?x=1"]);
});

test("正文只有内嵌 PDF 的页面：PDF 文字成为正文", async () => {
  const got = await extractFromUrl(`${base}/p/player-${T}`, { allowJina: false, subject: "test" });
  assert.ok(got, "抽得出正文");
  assert.equal(got.via, "pdf");
  assert.ok(got.text.includes(PDF_LINE1) && got.text.includes(PDF_LINE2), got.text.slice(0, 120));
});

test("转发语 + 附件 PDF：两者合并", async () => {
  const got = await extractFromUrl(`${base}/p/thin-${T}`, { allowJina: false, subject: "test" });
  assert.ok(got);
  assert.ok(got.text.includes(`现转发一项通知${T}`), "保留页面上的转发语");
  assert.ok(got.text.includes(PDF_LINE1) && got.text.includes(PDF_LINE2), "并入附件 PDF 的文字");
});

test("空正文区且无 PDF：抽不出（不编造）", async () => {
  assert.equal(await extractFromUrl(`${base}/p/empty-${T}`, { allowJina: false, subject: "test" }), null);
});

test("条目 URL 直接是 PDF：也可读", async () => {
  const got = await extractFromUrl(`${base}/direct-${T}.pdf`, { allowJina: false, subject: "test" });
  assert.ok(got && got.text.includes(PDF_LINE1) && got.text.includes(PDF_LINE2));
});

test("抽不到正文的条目：占位摘要进公开池，但不进精选", async () => {
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.com/pdf-${T}`, title: `关于某个事项的通知 ${T}`,
    bodyText: "", bodyStatus: "unconfirmed", via: "fetch", publishedAt: new Date("2026-10-08T01:02:03Z"),
  } as never);
  const res = await analyzeArticle(articleId);
  assert.equal(res!.output!.relevance, "pass", "薄正文条目不再卡 relevance");
  assert.equal(res!.output!.summaryZh, NO_BODY_SUMMARY, "摘要是如实占位，不编造");
  assert.equal(res!.output!.selected, false, "无正文条目不凭标题进精选");
  await publishArticle(articleId, { releasedAt: new Date() });
  const [pub] = await sql<{ eligible: boolean; selected: boolean; visibility: string }[]>`
    SELECT eligible, selected, visibility FROM publications WHERE article_id = ${articleId}`;
  assert.deepEqual(pub, { eligible: true, selected: false, visibility: "public" });
  const pool = await loadPool({ channel: "all", category: null, tag: null, topic: null, topicTags: null, sources: [SOURCE], q: null, tab: "time", type: "feed", now: new Date() });
  assert.equal(pool.items.length, 1, "进得了分类/全部列表");
  assert.equal(pool.items[0]!.summary, NO_BODY_SUMMARY);
});
