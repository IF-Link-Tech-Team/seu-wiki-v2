// 开发占位：让本地能演示「为你」的匹配效果，两部分都只在开发库上跑，不上生产。
//
// 1) 库里还没有任何公开条目时，先造几个演示信源（demo-*，永不抓取）和几条演示通知
//    （analyses 走 origin 'rule'，不调用模型）；
// 2) 按信源给存量条目打启发式 campus 值：
//      教务处     → valueTier action、identities [本科生]、deadline 30 天后（演示时效不衰减）
//      学生处     → valueTier action、identities [本科生]
//      研究生院   → identities [硕士生, 博士生]
//      就业       → valueTier opportunity、identities [本科生, 硕士生]，并补 tags 秋招春招
//      团委       → valueTier opportunity、identities [本科生, 硕士生]
//      学院信源   → colleges [学院全称]（按 industry/taxonomy.ts ENTITIES 的别名认）
//    正式数据由内容理解提示词提取受众字段（后续工作），届时投影自动从 analyses.campus 拷贝。
//
// 运行：node --env-file=.env scripts/dev-campus-backfill.ts   （幂等，可重跑）
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { COLLEGES } from "@aihot/industry/colleges";
import { ENTITIES } from "@aihot/industry/taxonomy";

const DEMO_SOURCES: Array<{ id: string; name: string }> = [
  { id: "demo-jwc", name: "教务处（演示）" },
  { id: "demo-job", name: "就业指导中心（演示）" },
  { id: "demo-radio", name: "信息科学与工程学院（演示）" },
  { id: "demo-tw", name: "校团委（演示）" },
  { id: "demo-lib", name: "图书馆（演示）" },
];

const DEMO_ITEMS: Array<{ source: string; title: string; tags: string[]; score: number }> = [
  { source: "demo-jwc", title: "2026 年春季学期选课将于 10 月 8 日开始", tags: ["教务通知"], score: 92 },
  { source: "demo-jwc", title: "关于 2025-2026 学年秋季学期期中考试安排的通知", tags: ["教务通知"], score: 80 },
  { source: "demo-job", title: "2026 届毕业生秋季校园招聘会（九龙湖校区）", tags: ["实习就业", "秋招春招"], score: 88 },
  { source: "demo-job", title: "暑期实习双选会企业名单公布", tags: ["实习就业", "实习"], score: 75 },
  { source: "demo-radio", title: "信息科学与工程学院 2026 届保研政策宣讲会", tags: ["交流升学", "保研"], score: 90 },
  { source: "demo-radio", title: "信息学院数学建模竞赛校内选拔报名", tags: ["竞赛科研", "数学建模"], score: 70 },
  { source: "demo-tw", title: "第十九届志愿服务文化节志愿者招募", tags: ["社团活动", "志愿服务"], score: 60 },
  { source: "demo-lib", title: "图书馆假期开放时间安排", tags: ["生活服务"], score: 55 },
];

/** 空库时造演示数据；已造过（demo-jwc 存在）或已有真实条目时跳过。 */
async function seedDemoIfEmpty() {
  const [{ n: pubs }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM publications`;
  const [demo] = await sql<{ id: string }[]>`SELECT id FROM sources WHERE id = 'demo-jwc'`;
  if (pubs > 0 || demo) return;
  for (const s of DEMO_SOURCES) {
    await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
              VALUES (${s.id}, ${s.name}, 'external', 'T1', 'editorial', '2100-01-01') ON CONFLICT (id) DO NOTHING`;
  }
  for (const it of DEMO_ITEMS) {
    const { articleId } = await upsertMaterial({
      sourceId: it.source, url: `https://demo.invalid/${it.source}/${DEMO_ITEMS.indexOf(it)}`, title: it.title,
      bodyText: "", bodyHtml: null, bodyStatus: "ok", via: "fetch", publishedAt: new Date(Date.now() - DEMO_ITEMS.indexOf(it) * 86400_000),
    });
    await sql`INSERT INTO analyses (article_id, input_revision, origin, relevance, category, tags, title_zh, summary_zh, reason_zh, score, selected)
              VALUES (${articleId}, 1, 'rule', 'pass', 'academic', ${it.tags}, ${it.title}, ${`${it.title}（演示摘要）`}, '演示', ${it.score}, true)`;
    await publishArticle(articleId, { releasedAt: new Date(Date.now() - 3600_000) });
  }
  console.log(`演示数据：${DEMO_SOURCES.length} 个信源、${DEMO_ITEMS.length} 条通知`);
}

interface Rule {
  match: RegExp;
  campus: Record<string, unknown>;
  addTags?: string[];
}

const deadline = new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);

const RULES: Rule[] = [
  { match: /教务/, campus: { valueTier: "action", identities: ["本科生"], deadline } },
  { match: /学生处|学工部/, campus: { valueTier: "action", identities: ["本科生"] } },
  { match: /研究生院|研工部/, campus: { identities: ["硕士生", "博士生"] } },
  { match: /就业|91job/, campus: { valueTier: "opportunity", identities: ["本科生", "硕士生"] }, addTags: ["秋招春招"] },
  { match: /团委/, campus: { valueTier: "opportunity", identities: ["本科生", "硕士生"] } },
];

// 学院信源：sources.name 命中 ENTITIES 里某个学院的别名。
const COLLEGE_RULES: Rule[] = Object.values(ENTITIES)
  .filter((e) => (COLLEGES as readonly string[]).includes(e.name))
  .map((e) => ({ match: new RegExp(e.aliases.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")), campus: { colleges: [e.name] } }));

await seedDemoIfEmpty();

const sources = await sql<{ id: string; name: string }[]>`SELECT id, name FROM sources`;
let touched = 0;
for (const source of sources) {
  const rule = [...RULES, ...COLLEGE_RULES].find((r) => r.match.test(source.name));
  if (!rule) continue;
  const campus = sql.json(rule.campus as never);
  const rows = await sql<{ article_id: string }[]>`
    UPDATE publications SET campus = ${campus} WHERE source_id = ${source.id} AND campus IS DISTINCT FROM ${campus}
    RETURNING article_id`;
  let tagged = 0;
  if (rule.addTags?.length) {
    const r = await sql<{ article_id: string }[]>`
      UPDATE publications SET tags = (SELECT array_agg(DISTINCT t) FROM unnest(tags || ${rule.addTags}::text[]) t)
      WHERE source_id = ${source.id} AND NOT (tags @> ${rule.addTags}::text[]) RETURNING article_id`;
    tagged = r.length;
  }
  touched += rows.length;
  console.log(`${source.name} (${source.id}): campus ← ${JSON.stringify(rule.campus)}，${rows.length} 条${tagged ? `，补标签 ${rule.addTags!.join("/")} ${tagged} 条` : ""}`);
}
console.log(touched ? `done, ${touched} 条打上了启发式 campus` : "done, 没有匹配的信源（先采集校园信源再跑）");
await closeDb();
