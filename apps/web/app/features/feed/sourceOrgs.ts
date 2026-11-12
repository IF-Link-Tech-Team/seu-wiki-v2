// 信源筛选面板的数据：把信源选项归成「单位 → 栏目」两级。同一单位下同名的栏目合成一行。
import type { SourceOption } from "@aihot/contracts/site";
import { SOURCE_GROUPS } from "@aihot/industry/source-orgs";

export interface SourceRow {
  /** 单位下的栏目名。 */
  label: string;
  /** 信源原名，用于已选 chip。 */
  name: string;
  ids: string[];
}

export interface SourceOrg {
  org: string;
  group: string;
  ids: string[];
  rows: SourceRow[];
}

const OTHER_GROUP = "其他";
export const SOURCE_GROUP_ORDER: string[] = [...SOURCE_GROUPS, OTHER_GROUP];

/** 分组内按拼音排序；同一单位跨分组时取靠前的分组。 */
export function groupSourceOptions(options: SourceOption[]): SourceOrg[] {
  const orgs = new Map<string, SourceOrg>();
  for (const o of options) {
    const group = o.group ?? OTHER_GROUP;
    let entry = orgs.get(o.org);
    if (!entry) orgs.set(o.org, (entry = { org: o.org, group, ids: [], rows: [] }));
    if (SOURCE_GROUP_ORDER.indexOf(group) < SOURCE_GROUP_ORDER.indexOf(entry.group)) entry.group = group;
    entry.ids.push(o.id);
    const row = entry.rows.find((r) => r.label === o.label);
    if (row) row.ids.push(o.id);
    else entry.rows.push({ label: o.label, name: o.name, ids: [o.id] });
  }
  return [...orgs.values()].sort((a, b) => SOURCE_GROUP_ORDER.indexOf(a.group) - SOURCE_GROUP_ORDER.indexOf(b.group) || a.org.localeCompare(b.org, "zh-Hans-CN"));
}

/** 搜索：单位名命中保留整个单位，否则只留命中的栏目。 */
export function matchSourceOrgs(orgs: SourceOrg[], query: string): SourceOrg[] {
  const q = query.trim().toLowerCase();
  if (!q) return orgs;
  return orgs.flatMap((o) => {
    if (o.org.toLowerCase().includes(q)) return [o];
    const rows = o.rows.filter((r) => r.name.toLowerCase().includes(q));
    return rows.length ? [{ ...o, rows }] : [];
  });
}

/** 已选信源的 chip：整个单位都选中时合成一个，其余一行一个；对不上选项的 id 原样显示。 */
export function selectedSourceChips(orgs: SourceOrg[], selected: string[]): Array<{ label: string; ids: string[] }> {
  const picked = new Set(selected);
  const chips: Array<{ label: string; ids: string[] }> = [];
  const known = new Set<string>();
  for (const o of orgs) {
    o.ids.forEach((id) => known.add(id));
    if (o.rows.length > 1 && o.ids.every((id) => picked.has(id))) {
      chips.push({ label: `${o.org}·全部`, ids: o.ids });
      continue;
    }
    for (const r of o.rows) {
      const ids = r.ids.filter((id) => picked.has(id));
      if (ids.length) chips.push({ label: r.name, ids });
    }
  }
  for (const id of selected) if (!known.has(id)) chips.push({ label: id, ids: [id] });
  return chips;
}
