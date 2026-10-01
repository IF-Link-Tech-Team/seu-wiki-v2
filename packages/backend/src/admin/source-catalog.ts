// 信源目录：industry/source-catalog.json 的候选底册 + 在库状态匹配，供后台「信源目录」勾选入库。
// 目录是静态文件（Git 可追溯）；匹配键：网站按 config.url，公众号按 wxid/ghid/nickname/名称。
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.ts";
import { sql } from "../db.ts";

export interface CatalogEntry {
  catalogId: string | null;
  name: string;
  kind: "web_list" | "mp_account";
  url: string | null;
  wxid: string | null;
  category: string;
  official: boolean;
  note: string;
  /** false = 仅参考（官网首页/服务器抓不了的入口），不可勾选入库。 */
  collectible?: boolean;
}

export interface CatalogItem extends CatalogEntry {
  key: string;
  /** 已在采集池时给出已存在的信源 ID。 */
  existingSourceId: string | null;
  /** 入库草稿（kind + config），前端勾选后直接 POST /api/admin/sources。 */
  draft: { kind: string; config: Record<string, unknown> };
}

let cache: CatalogEntry[] | null = null;

function catalog(): CatalogEntry[] {
  if (!cache) {
    const raw = JSON.parse(readFileSync(path.join(REPO_ROOT, "industry/source-catalog.json"), "utf8")) as { entries: CatalogEntry[] };
    cache = raw.entries;
  }
  return cache;
}

export async function sourceCatalog(): Promise<{ categories: string[]; items: CatalogItem[] }> {
  const entries = catalog();
  const existing = await sql<{ id: string; name: string; config: Record<string, unknown> }[]>`
    SELECT id, name, config FROM sources`;
  const byUrl = new Map<string, string>();
  const byMp = new Map<string, string>();
  for (const s of existing) {
    const url = typeof s.config.url === "string" ? s.config.url.replace(/\/+$/, "") : null;
    if (url) byUrl.set(url, s.id);
    for (const k of ["wxid", "ghid", "nickname"] as const) {
      const v = s.config[k];
      if (typeof v === "string" && v) byMp.set(v, s.id);
    }
    byMp.set(s.name.replace(/^公众号·/, ""), s.id);
  }
  const items: CatalogItem[] = entries.map((e, i) => {
    const key = e.catalogId ?? `c${i}`;
    let existingSourceId: string | null = null;
    if (e.kind === "web_list" && e.url) existingSourceId = byUrl.get(e.url.replace(/\/+$/, "")) ?? null;
    if (e.kind === "mp_account") existingSourceId = (e.wxid && byMp.get(e.wxid)) || byMp.get(e.name) || null;
    return { ...e, key, existingSourceId, draft: catalogDraft(e) };
  });
  return { categories: [...new Set(items.map((i) => i.category))], items };
}

/** 勾选入库用的草稿：网页源预填 WebPlus 常见模板（选择器以预览抓取为准），公众号填昵称/微信号。 */
export function catalogDraft(e: CatalogEntry): CatalogItem["draft"] {
  if (e.kind === "mp_account") {
    return { kind: "mp_account", config: { ...(e.wxid ? { wxid: e.wxid } : {}), nickname: e.name } };
  }
  const url = e.url!;
  return {
    kind: "web_list",
    config: {
      url,
      baseUrl: new URL(url).origin,
      itemSelector: "li.list_item",
      linkSelector: "a",
      titleSelector: "span.Article_Title",
      publishedAtSelector: "span.Article_PublishDate",
      allowUrlPrefixes: [new URL(url).origin + "/"],
    },
  };
}
