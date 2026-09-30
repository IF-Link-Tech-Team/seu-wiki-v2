import { SITE } from "@aihot/industry/site";
import { useMemo, useState } from "react";
import { Link, useRevalidator } from "react-router";
import type { Route } from "./+types/source-catalog";
import { useAdminAction } from "../../features/admin/action";
import { toast } from "../../features/admin/toast";
import { KIND_LABEL } from "../../features/admin/labels";
import { AdminPage, Badge, Button, Card, Empty, Input, Stat } from "../../features/admin/ui";
import { adminGet } from "../../lib/admin.server";

interface CatalogItem {
  key: string;
  catalogId: string | null;
  name: string;
  kind: "web_list" | "mp_account";
  url: string | null;
  wxid: string | null;
  category: string;
  official: boolean;
  note: string;
  existingSourceId: string | null;
  draft: { kind: string; config: Record<string, unknown> };
}

interface CatalogData {
  categories: string[];
  items: CatalogItem[];
}

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<CatalogData>(request, "/api/admin/source-catalog");
}

export const meta: Route.MetaFunction = () => [{ title: `信源目录 · ${SITE.name} 后台` }];

/** 入库 ID：优先底册编号（cat-s050），否则按域名/微信号生成。 */
function slugFor(item: CatalogItem): string {
  let base = item.catalogId?.toLowerCase() ?? "";
  if (!base && item.kind === "web_list" && item.url) {
    try {
      base = new URL(item.url).hostname;
    } catch {
      base = "";
    }
  }
  if (!base) base = item.wxid ?? item.name;
  const slug = `cat-${base}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return slug.length >= 3 ? slug : `${slug}-src`;
}

type Mark = "ok" | "dup" | "fail";

export default function SourceCatalog({ loaderData }: Route.ComponentProps) {
  const { categories, items } = loaderData;
  const { run } = useAdminAction();
  const revalidator = useRevalidator();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => [i.name, i.catalogId ?? "", i.url ?? "", i.wxid ?? "", i.note].join(" ").toLowerCase().includes(q));
  }, [items, search]);

  const groups = useMemo(
    () => categories.map((c) => ({ category: c, rows: filtered.filter((i) => i.category === c) })).filter((g) => g.rows.length),
    [categories, filtered],
  );

  const imported = new Set(items.filter((i) => i.existingSourceId || marks[i.key] === "ok" || marks[i.key] === "dup").map((i) => i.key));
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const toggleGroup = (rows: CatalogItem[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of rows) if (!imported.has(r.key)) {
        if (on) next.add(r.key);
        else next.delete(r.key);
      }
      return next;
    });

  const selectedItems = items.filter((i) => selected.has(i.key) && !imported.has(i.key));

  async function importSelected() {
    if (!selectedItems.length || importing) return;
    setImporting(true);
    let ok = 0;
    let dup = 0;
    let fail = 0;
    for (const item of selectedItems) {
      const r = await run<{ created: boolean; duplicate?: { id: string }; source?: { id: string; updated_at: string } }>(
        "POST",
        "/api/admin/sources",
        {
          id: slugFor(item),
          name: item.kind === "mp_account" ? `公众号·${item.name}` : item.name,
          kind: item.draft.kind,
          config: item.draft.config,
          tier: "T2",
          participation_mode: "editorial",
          interval_minutes: 60,
          first_party: item.official,
          tags: [item.category],
          site_fulltext: false,
          syndicate_fulltext: false,
        },
        { label: `catalog:${item.key}`, revalidate: false },
      );
      if (r?.created && r.source) {
        // 入库即停用：选择器是模板预填，逐个预览确认后才启用。
        await run("PATCH", `/api/admin/sources/${encodeURIComponent(r.source.id)}`, { patch: { enabled: false }, version: r.source.updated_at, reason: "信源目录勾选入库，先停用待预览" }, { label: `catalog-pause:${item.key}`, revalidate: false });
        setMarks((m) => ({ ...m, [item.key]: "ok" }));
        ok += 1;
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(item.key);
          return next;
        });
      } else if (r && !r.created) {
        setMarks((m) => ({ ...m, [item.key]: "dup" }));
        dup += 1;
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(item.key);
          return next;
        });
      } else {
        setMarks((m) => ({ ...m, [item.key]: "fail" }));
        fail += 1;
      }
    }
    setImporting(false);
    toast(`入库完成：新增 ${ok}，已存在 ${dup}${fail ? `，失败 ${fail}` : ""}。均为停用状态，请到信源列表逐个预览后启用。`, ok || dup ? "ok" : "error");
    revalidator.revalidate();
  }

  return (
    <AdminPage
      title="信源目录"
      subtitle="候选底册来自已调研的东南大学信息源清单。勾选后「加入采集池」：以停用状态入库（不触发采集），到信源详情页预览抓取确认选择器无误后再启用。"
      actions={
        <Button tone="primary" busy={importing} disabled={!selectedItems.length} onClick={importSelected}>
          加入采集池（{selectedItems.length}）
        </Button>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="候选" value={items.length} />
        <Stat label="已在采集池" value={imported.size} tone={imported.size ? "ok" : undefined} />
        <Stat label="已勾选" value={selectedItems.length} tone={selectedItems.length ? "warn" : undefined} />
        <div className="flex items-center">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索名称、编号、地址、备注" aria-label="搜索目录" />
        </div>
      </div>
      {!groups.length && <Empty>没有匹配的候选信源。</Empty>}
      <div className="space-y-5">
        {groups.map((g) => {
          const selectable = g.rows.filter((r) => !imported.has(r.key));
          const allOn = selectable.length > 0 && selectable.every((r) => selected.has(r.key));
          return (
            <Card
              key={g.category}
              pad={false}
              title={
                <label className="inline-flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={allOn} disabled={!selectable.length} onChange={(e) => toggleGroup(g.rows, e.target.checked)} aria-label={`全选 ${g.category}`} />
                  {g.category}
                </label>
              }
              right={<span>{g.rows.filter((r) => imported.has(r.key)).length} / {g.rows.length} 已入库</span>}
            >
              <ul className="divide-y divide-line">
                {g.rows.map((item) => {
                  const inPool = imported.has(item.key);
                  const existingId = item.existingSourceId;
                  const mark = marks[item.key];
                  return (
                    <li key={item.key}>
                      <label className={`flex items-start gap-3 px-4 py-3 ${inPool ? "opacity-55" : "cursor-pointer hover:bg-bg-sunk/40"}`}>
                        <input
                          type="checkbox"
                          className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
                          checked={inPool || selected.has(item.key)}
                          disabled={inPool || importing}
                          onChange={() => toggle(item.key)}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink">{item.name}</span>
                            <Badge>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                            {item.official && <Badge tone="ok">官方</Badge>}
                            {item.catalogId && <span className="num text-[11.5px] text-ink-4">{item.catalogId}</span>}
                          </div>
                          {(item.url || item.wxid) && <div className="mt-0.5 truncate font-mono text-[11.5px] text-ink-4">{item.url ?? `微信号 ${item.wxid}`}</div>}
                          {item.note && <div className="mt-0.5 text-[12.5px] text-ink-3">{item.note}</div>}
                        </div>
                        <div className="shrink-0 pt-0.5">
                          {existingId ? (
                            <Link to={`/admin/sources/${encodeURIComponent(existingId)}`} onClick={(e) => e.stopPropagation()}>
                              <Badge tone="accent">已入库</Badge>
                            </Link>
                          ) : mark === "ok" ? (
                            <Badge tone="ok">已加入</Badge>
                          ) : mark === "dup" ? (
                            <Badge tone="accent">已存在</Badge>
                          ) : mark === "fail" ? (
                            <Badge tone="bad">失败</Badge>
                          ) : null}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </Card>
          );
        })}
      </div>
    </AdminPage>
  );
}
