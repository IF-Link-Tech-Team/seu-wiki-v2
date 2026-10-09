// 知识内容模块：Markdown/MDX → 静态 HTML 的转换（frontmatter、slug、:::note、JSX 剥离、加粗修复、
// 图片重写、脚本过滤），docs 读取层（详情、上下篇、经验三维筛选）与旧址 301 映射。
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { convertDocFull, parseFrontmatter, repairStrongMarkers, slugPath, slugSegment } from "@aihot/backend/knowledge/markdown";
import { loadDoc, loadExperienceIndex, loadSurvivalIndex, resolveDocRedirect } from "@aihot/backend/publication/docs";
import { resolveRedirect } from "@aihot/contracts/http-policy";
import { buildApp } from "../apps/api/src/app.ts";

const T = tag();
const app = await buildApp();

after(async () => {
  await sql`DELETE FROM docs WHERE slug LIKE ${`%${T}%`} OR slug IN ('survival/测试篇/a', 'survival/测试篇/b')`;
  await sql`DELETE FROM doc_redirects WHERE old_path LIKE ${`%/test-${T}%`} OR old_path = '/survival/测试篇/old-compat/'`;
  await app.close();
  await stopBoss();
  await closeDb();
});

test("slug 规则与旧站 URL 一致（survival.ts 目录条目口径）", () => {
  assert.equal(slugPath("survival/方向篇/升学/1 保研篇"), "survival/方向篇/升学/1-保研篇");
  assert.equal(slugPath("survival/方向篇/其他/待业_GAP"), "survival/方向篇/其他/待业_gap");
  assert.equal(slugPath("survival/方向篇/选调考公/【选调】一个意识流青年的碎碎念"), "survival/方向篇/选调考公/选调一个意识流青年的碎碎念");
  assert.equal(slugPath("survival/学习篇/学业/2 拓展性学习/海外交流/海外交流体会（一）"), "survival/学习篇/学业/2-拓展性学习/海外交流/海外交流体会一");
  assert.equal(slugPath("survival/学习篇/学业/2 拓展性学习/SRTP项目"), "survival/学习篇/学业/2-拓展性学习/srtp项目");
  assert.equal(slugSegment("5 行业、岗位分享"), "5-行业岗位分享");
});

test("frontmatter：标量、引号、sidebar 缩进", () => {
  const { data, body } = parseFrontmatter(`---\ntitle: '转系分享 Stella'\ncollege: 通用\nsidebar:\n  label: 'Stella：从机械到信息'\n  hidden: true\n---\n正文第一行`);
  assert.equal(data.title, "转系分享 Stella");
  assert.equal(data.sidebar?.label, "Stella：从机械到信息");
  assert.equal(data.sidebar?.hidden, true);
  assert.equal(body, "正文第一行");
});

test("转换：:::note 成静态 aside，MDX import/JSX 剥离并告警，脚本被过滤", () => {
  const raw = `---\ntitle: 测试\n---\nimport Exp from '../components/Exp.astro';\n\n:::note[原文说明]\n正文**未改写**。\n:::\n\n<Exp client:load />\n\n<script>alert(1)</script>\n\n正常段落。`;
  const r = convertDocFull(raw);
  assert.ok(r.html.includes('class="doc-note doc-note-note"'), "提示块转 aside");
  assert.ok(r.html.includes('doc-note-title">原文说明<'), "提示块标题");
  assert.ok(!r.html.includes("<script"), "脚本被过滤");
  assert.ok(!r.html.includes("Exp"), "JSX 组件被剥离");
  assert.ok(r.warnings.some((w) => w.includes("import")), "剥离有告警");
});

test("转换：章节锚点、span 锚点保留、图片相对路径重写、加粗边界修复", () => {
  const raw = `## 第一步 准备\n\n<span id="abc123" aria-hidden="true"></span>\n\n![图](../assets/pic.png)\n\n**宿舍卫生**，如果你本人}`;
  const r = convertDocFull(raw, { repairStrong: true, resolveImage: (src) => (src.endsWith("pic.png") ? "/knowledge-assets/pic.png" : null) });
  assert.ok(r.html.includes('<h2 id="第一步-准备"'), "标题补锚点");
  assert.deepEqual(r.headings, [{ id: "第一步-准备", text: "第一步 准备", depth: 2 }]);
  assert.ok(r.html.includes('<span id="abc123"'), "自定义锚点保留");
  assert.ok(r.html.includes('src="/knowledge-assets/pic.png"'), "图片重写");
  assert.ok(r.html.includes("<strong>宿舍卫生</strong>，"), "加粗边界修复");
  assert.equal(repairStrongMarkers("`code ** not bold **`"), "`code ** not bold **`", "代码段不动");
});

async function seedDocs() {
  const doc = (slug: string, kind: string, part: string | null, position: number, extra: Record<string, unknown> = {}) =>
    sql`INSERT INTO docs (slug, kind, title, html, part, position, category, grade, college, occurred_at, content_hash)
        VALUES (${slug}, ${kind}, ${`${slug}-${T}`}, '<p>正文</p>', ${part}, ${position},
                ${(extra.category as string) ?? null}, ${(extra.grade as string) ?? null}, ${(extra.college as string) ?? null},
                ${(extra.occurredAt as string) ?? null}, ${T})`;
  await doc("survival/测试篇/a", "survival", "viewpoint", 1);
  await doc("survival/测试篇/b", "survival", "viewpoint", 2);
  await doc(`experience/x/exp1-${T}`, "experience", null, 0, { category: "转专业", grade: "大一", college: "通用", occurredAt: "2019" });
  await doc(`experience/x/exp2-${T}`, "experience", null, 0, { category: "海外交流", grade: "大三", college: "信息科学与工程学院", occurredAt: "2021-08" });
}

test("读取层：详情带上下篇、目录树、经验三维筛选、旧址 301", async () => {
  await seedDocs();
  const b = await loadDoc("survival/测试篇/b");
  assert.equal(b!.prev?.slug, "survival/测试篇/a");
  assert.equal(b!.next, null);
  const tree = await loadSurvivalIndex();
  assert.ok(tree.parts.some((p) => p.key === "viewpoint" && p.groups.flatMap((g) => g.items).some((i) => i.slug === "survival/测试篇/a")));

  const all = await loadExperienceIndex({});
  assert.ok(all.items.filter((i) => i.slug.includes(T)).length === 2);
  const filtered = await loadExperienceIndex({ category: ["转专业"] });
  assert.deepEqual(filtered.items.map((i) => i.slug).filter((s) => s.includes(T)), [`experience/x/exp1-${T}`]);
  const multi = await loadExperienceIndex({ category: ["转专业", "海外交流"], grade: ["大一"] });
  assert.deepEqual(multi.items.map((i) => i.slug).filter((s) => s.includes(T)), [`experience/x/exp1-${T}`], "组内 OR、跨组 AND");

  await sql`INSERT INTO doc_redirects (old_path, target) VALUES (${"/survival/测试篇/old-compat/"}, ${`/experience/x/exp1-${T}/`})`;
  assert.equal(await resolveDocRedirect("/survival/测试篇/old-compat"), `/experience/x/exp1-${T}/`, "结尾斜杠有无都认");
  assert.equal(await resolveDocRedirect("/survival/nowhere"), null);
});

test("API：文档详情、经验列表、映射查询与旧入口 301", async () => {
  const res = await app.inject({ method: "GET", url: "/api/site/docs/survival/测试篇/b" });
  assert.equal(res.statusCode, 200);
  assert.equal((res.json() as { slug: string }).slug, "survival/测试篇/b");
  const red = await app.inject({ method: "GET", url: `/api/site/doc-redirect?path=${encodeURIComponent("/survival/测试篇/old-compat/")}` });
  assert.equal(red.statusCode, 200);
  const list = await app.inject({ method: "GET", url: `/api/site/docs/experience?category=${encodeURIComponent("转专业")}` });
  assert.equal(list.statusCode, 200);
  assert.equal(resolveRedirect("/news/", "")?.location, "/all");
  assert.equal(resolveRedirect("/news", "")?.status, 301);
  assert.equal(resolveRedirect("/contribute/", "")?.location, "/feedback");
});

test("文档路径兼容末尾斜杠，空路径和异常长路径返回 404", async () => {
  for (const suffix of ["/", "///"]) {
    const res = await app.inject({ method: "GET", url: `/api/site/docs/survival/测试篇/b${suffix}` });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().slug, "survival/测试篇/b");
  }
  for (const slug of ["////", "/".repeat(32_000) + "x"]) {
    const res = await app.inject({ method: "GET", url: `/api/site/docs/${slug}` });
    assert.equal(res.statusCode, 404);
  }
});
