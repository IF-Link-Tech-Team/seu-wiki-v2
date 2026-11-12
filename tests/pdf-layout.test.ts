import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPdfText, pdfTextToHtml } from "../packages/backend/src/content/pdf.ts";

// Real PDF text positions: wrapped lines, indented paragraphs, headings and page furniture.
function makePdf(pages: Array<Array<[string, number, number]>>): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  const unicode = pages.some((lines) => lines.some(([text]) => /[^\x00-\x7f]/.test(text)));
  if (unicode) {
    const cmap = "/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Unicode def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange 1 beginbfrange <0000> <FFFF> <0000> endbfrange endcmap CMapName currentdict /CMap defineresource pop end end";
    objects[2] = "<< /Type /Font /Subtype /Type0 /BaseFont /SimSun /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 5 0 R >>";
    objects.push("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /SimSun /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 >>", `<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream`);
  }
  const kids: number[] = [];
  for (const lines of pages) {
    const pageId = objects.length + 1;
    kids.push(pageId);
    const stream = lines.map(([text, x, y]) => {
      const encoded = unicode ? `<${Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("")}>` : `(${text})`;
      return `BT /F1 12 Tf ${x} ${y} Td ${encoded} Tj ET`;
    }).join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.map((id) => `${id} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const offset = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

test("PDF wraps form paragraphs, with headings and indentation preserved", async () => {
  const text = await extractPdfText(makePdf([[
    ["Selection notice", 220, 720],
    ["This paragraph continues across the physical", 96, 660],
    ["line and ends here.", 72, 636],
    ["Another paragraph starts here and continues", 96, 612],
    ["on the following line.", 72, 588],
  ]]));
  assert.equal(pdfTextToHtml(text!), "<p>Selection notice</p><p>This paragraph continues across the physical line and ends here.</p><p>Another paragraph starts here and continues on the following line.</p>");
});

test("page numbers do not interrupt a paragraph across pages", async () => {
  const text = await extractPdfText(makePdf([
    [["1", 300, 770], ["This paragraph continues onto", 72, 80], ["the next", 72, 56], ["1", 300, 20]],
    [["2", 300, 770], ["page without a paragraph break.", 72, 720], ["2", 300, 20]],
  ]));
  assert.equal(pdfTextToHtml(text!), "<p>This paragraph continues onto the next page without a paragraph break.</p>");
});

test("paragraph HTML escapes markup and ignores empty blocks", () => {
  assert.equal(pdfTextToHtml("通知 <附件> & 说明\n\n\n一、选拔条件\n\n1、按要求报名。"), "<p>通知 &lt;附件&gt; &amp; 说明</p><p>一、选拔条件</p><p>1、按要求报名。</p>");
});

test("Chinese wrapped words and cross-page continuations join without spaces; clauses stay separate", async () => {
  const text = await extractPdfText(makePdf([
    [
      ["— 1 —", 280, 770],
      ["一、选拔条件", 72, 720],
      ["1、爱国荣校，遵纪守法，有扎实的知识基", 96, 680],
    ],
    [
      ["— 2 —", 280, 770],
      ["础，有攀登科学技术高峰的远大抱负；", 72, 720],
      ["勇于拼搏和乐于志愿服务与奉献的精神。", 72, 696],
      ["2、满足下列条件之一：", 96, 672],
      ["（1）学习成绩优秀，无首修不及格。", 96, 648],
    ],
  ]));
  assert.equal(pdfTextToHtml(text!), "<p>一、选拔条件</p><p>1、爱国荣校，遵纪守法，有扎实的知识基础，有攀登科学技术高峰的远大抱负；勇于拼搏和乐于志愿服务与奉献的精神。</p><p>2、满足下列条件之一：</p><p>（1）学习成绩优秀，无首修不及格。</p>");
});

test("numeric body content is preserved", async () => {
  const text = await extractPdfText(makePdf([[["2026", 72, 770], ["The required minimum score is", 72, 720], ["100", 72, 696], ["Applications close in November.", 72, 650]]]));
  assert.ok(text?.includes("100"));
  assert.ok(text?.includes("2026"));
});
