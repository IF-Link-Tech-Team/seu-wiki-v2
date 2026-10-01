// 一次性运维脚本：把 industry/sources.json 里存量源的新配置/site_fulltext 通过 updateSource 落入生产库。
// 走 updateSource 正式路径：审计日志 + PUBLICATION_FIELDS 变更自动排队重发布。
// 用法：docker exec aihot-api-1 node /app/scripts/ops-apply-sources.ts
import { readFileSync } from "node:fs";
import { updateSource } from "/app/packages/backend/src/admin/sources.ts";
import { sql, closeDb } from "/app/packages/backend/src/db.ts";

const { sources } = JSON.parse(readFileSync("/app/industry/sources.json", "utf8"));
const IDS = ["jwc-xxtz", "jwc-xjgl", "electronic-tzgg", "bme-news", "radio-zqkh", "automation-tzgg", "news-xsdt", "mp-seu", "mp-seu-jwc", "mp-seu-jyzd"];

for (const id of IDS) {
  const s = sources.find((x) => x.id === id);
  if (!s) { console.log(`skip ${id}: not in sources.json`); continue; }
  const [row] = await sql`SELECT updated_at FROM sources WHERE id = ${id}`;
  if (!row) { console.log(`skip ${id}: not in db`); continue; }
  const patch = { site_fulltext: true, enabled: s.enabled !== false, config: s.config, name: s.name };
  const r = await updateSource(id, { patch, version: new Date(row.updated_at).toISOString(), reason: "坐实后统一修正：site_fulltext 打开（官方内容站内展示全文），jwc 选择器收窄，electronic 换活跃频道" }, "yunfan(ops)");
  console.log(r ? `ok ${id}` : `FAIL ${id}`);
}
await closeDb();
