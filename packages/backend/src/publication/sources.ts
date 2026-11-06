// 信源筛选器的选项列表：产出过公开条目的启用信源，按组别与名称排序。
import type { SourceListResponse } from "@aihot/contracts/site";
import { sourceOrg } from "@aihot/industry/source-orgs";
import { sql } from "../db.ts";

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
    sources: rows.map((r) => ({ id: r.id, name: r.name, ...sourceOrg(r.name, r.tags) })),
  };
}
