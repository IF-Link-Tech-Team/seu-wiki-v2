// 信源筛选器的选项列表：产出过公开条目的启用信源，按组别与名称排序。
import type { SourceListResponse } from "@aihot/contracts/site";
import { sql } from "../db.ts";

/** sources.tags 里的来源组别词（新旧两套口径都认），筛选面板按这个顺序分组；其余落入“其他”。 */
export const SOURCE_GROUPS = ["学院与书院", "机关与职能部门", "校级媒体与权益服务", "校区与社区空间", "学院", "机关", "校级", "公众号"] as const;

interface SourceRow {
  id: string;
  name: string;
  tags: string[];
}

export async function listPublicSources(): Promise<SourceListResponse> {
  const rows = await sql<SourceRow[]>`
    SELECT s.id, s.name, s.tags FROM sources s
    WHERE s.enabled AND EXISTS (
      SELECT 1 FROM publications p WHERE p.source_id = s.id AND p.visibility = 'public' AND p.eligible
    )
    ORDER BY s.name`;
  return {
    sources: rows.map((r) => ({
      id: r.id,
      name: r.name,
      group: SOURCE_GROUPS.find((g) => r.tags.includes(g)) ?? null,
    })),
  };
}
