import { z } from "zod";
import type { ActivitySchedule, ActivityScheduleEntry, ActivityScheduleTime, TimelineCard, TimelineFilters } from "@aihot/contracts/site";
import { isValidDate } from "@aihot/contracts/time";
import { sql } from "../db.ts";
import { categoryCondition, channelCondition, sourceCondition, tagCondition } from "./items.ts";

const fields = ["registrationStart", "registrationEnd", "activityStart", "activityEnd"] as const;
const text = z.string().trim().min(1).max(300);
const timeSchema = z.object({ evidence: text, value: z.string().nullable(), precision: z.enum(["day", "minute", "second"]).nullable() });
const entrySchema = z.object({
  name: text, participation: text.optional(),
  registrationStart: timeSchema.optional(), registrationEnd: timeSchema.optional(),
  activityStart: timeSchema.optional(), activityEnd: timeSchema.optional(),
});
const editorialSchema = z.object({
  kind: z.enum(["activity_notice", "activity_registration", "activity_update"]), evidence: text,
  decision: z.enum(["candidate", "review", "excluded"]), activities: z.array(entrySchema).max(4),
  update: z.enum(["rescheduled", "cancelled", "other"]).optional(),
});
const review = (): ActivitySchedule => ({ activities: [], notice: "时间待核实" });

function publicTime(raw: z.infer<typeof timeSchema>): ActivityScheduleTime | null {
  if (raw.value === null) {
    // Unresolved calendar phrases may be ambiguous or invalid. Only explicit non-date arrangements
    // can be displayed verbatim without making an unverified date appear authoritative.
    return raw.precision === null && /^(?:报满即止|额满即止|另行通知|待定|暂未公布|尚未公布|无需报名)$/.test(raw.evidence)
      ? { text: raw.evidence, value: null, precision: null } : null;
  }
  const valid = raw.precision === "day" ? isValidDate(raw.value)
    : raw.precision !== null && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?\+08:00$/.test(raw.value)
      && isValidDate(raw.value.slice(0, 10)) && Number.isFinite(Date.parse(raw.value))
      && Number(raw.value.slice(11, 13)) < 24 && Number(raw.value.slice(14, 16)) < 60
      && (raw.value.length < 25 || Number(raw.value.slice(17, 19)) < 60);
  return valid ? { text: raw.evidence, value: raw.value, precision: raw.precision } : null;
}

/** Expose only checked activity facts from the already-published judgement, never model metadata. */
export function projectActivitySchedule(raw: unknown): ActivitySchedule | null {
  const parsed = editorialSchema.safeParse(raw);
  if (!parsed.success || parsed.data.decision === "excluded") return null;
  const data = parsed.data;
  if (data.kind === "activity_update" && data.update === "cancelled") return { activities: [], notice: "活动已取消" };
  if (data.kind === "activity_update" || data.decision === "review") return review();
  const activities: ActivityScheduleEntry[] = [];
  for (const item of data.activities) {
    const entry: ActivityScheduleEntry = { name: item.name };
    for (const field of fields) {
      if (!item[field]) continue;
      const value = publicTime(item[field]);
      if (!value) return review();
      entry[field] = value;
    }
    for (const [startKey, endKey] of [["registrationStart", "registrationEnd"], ["activityStart", "activityEnd"]] as const) {
      const start = entry[startKey];
      const end = entry[endKey];
      if (!start?.value || !end?.value) continue;
      const reversed = start.precision === "day" || end.precision === "day" ? start.value.slice(0, 10) > end.value.slice(0, 10)
        : Date.parse(start.value) > Date.parse(end.value);
      if (reversed) return review();
    }
    if (item.participation) {
      if (/(?:^|[，。；：、\s])无需报名(?=$|[，。；、\s])/.test(item.participation)) entry.registrationNote = "无需报名";
      else if (/(?:^|[，。；：、\s])(?:报满即止|额满即止)(?=$|[，。；、\s])/.test(item.participation)) entry.registrationNote = item.participation.match(/报满即止|额满即止/)![0];
    }
    if (entry.registrationNote === "无需报名" && (entry.registrationStart || entry.registrationEnd)) return review();
    if (fields.some((field) => entry[field]) || entry.registrationNote) activities.push(entry);
  }
  return activities.length ? { activities } : null;
}

/** A newer same-name change invalidates old times; different reports never supply missing endpoints. */
export function resolveActivitySchedule(raw: unknown, related: Array<{ editorial: unknown; at: number }>, at: number): ActivitySchedule | null {
  const base = projectActivitySchedule(raw);
  const parsedBase = editorialSchema.safeParse(raw);
  if (!base || !parsedBase.success) return base;
  const nameOf = (entry: { name: string }) => entry.name.normalize("NFKC").trim();
  const names = new Set(parsedBase.data.activities.map(nameOf));
  if (!names.size) return base;
  const relevant = related.flatMap((row) => {
    if (row.at < at) return [];
    const parsed = editorialSchema.safeParse(row.editorial);
    return parsed.success && parsed.data.decision !== "excluded" && parsed.data.activities.some((entry) => names.has(nameOf(entry)))
      ? [{ data: parsed.data, at: row.at }] : [];
  }).sort((a, b) => b.at - a.at);
  const signature = (value: z.infer<typeof editorialSchema>) => JSON.stringify({ kind: value.kind, update: value.update, schedule: projectActivitySchedule(value), names: value.activities.map(nameOf).sort() });
  for (let index = 0; index < relevant.length; index++) {
    const row = relevant[index]!;
    if (index > 0 && relevant[index - 1]!.at === row.at) continue;
    const data = row.data;
    const simultaneous = relevant.filter((other) => other.at === row.at);
    // Date-only publication times often coincide. Contradictory notices at the same instant cannot
    // be ordered by database row order or by when a collector happened to discover them.
    if (new Set(simultaneous.map((other) => signature(other.data))).size > 1) return review();
    const matches = data.activities.filter((entry) => names.has(nameOf(entry)));
    const matchedNames = new Set(matches.map(nameOf));
    const coversAll = names.size === parsedBase.data.activities.length && matchedNames.size === names.size && matches.length === matchedNames.size;
    if (matches.length !== matchedNames.size || names.size !== parsedBase.data.activities.length) return review();
    if (row.at === at && (data.kind === "activity_update" || parsedBase.data.kind === "activity_update" || /(?:重新开放|恢复|重启)报名/.test(data.evidence))) return review();
    if (data.kind === "activity_update") {
      return data.update === "cancelled" && coversAll
        ? { activities: [], notice: "活动已取消" } : review();
    }
    const other = projectActivitySchedule(data);
    if (other?.notice) return review();
    if (data.kind === "activity_registration" && /(?:重新开放|恢复|重启)报名/.test(data.evidence)) {
      return coversAll && other ? { activities: other.activities.filter((entry) => names.has(nameOf(entry))) } : review();
    }
    for (const entry of other?.activities ?? []) {
      const previous = base.activities.find((item) => nameOf(item) === nameOf(entry));
      if (previous && fields.some((field) => previous[field]?.value && entry[field]?.value && previous[field]!.value !== entry[field]!.value)) return review();
    }
  }
  return base;
}

/** Batch only the current selected page and its public related notices; a page read never calls AI. */
export async function loadActivitySchedules(cards: TimelineCard[], filters: TimelineFilters, now: Date): Promise<Map<string, ActivitySchedule>> {
  if (!cards.length) return new Map();
  const ids = cards.map((card) => card.item.id);
  type Row = { id: string; selected: boolean; story_id: number | null; fact_id: number | null; at: Date; editorial: unknown };
  const columns = sql`p.article_id AS id, p.selected, p.story_id, p.fact_id, coalesce(p.published_at, p.timeline_at) AS at,
    an.output->'editorial' AS editorial`;
  const from = sql`
    FROM publications p JOIN sources s ON s.id = p.source_id JOIN articles a ON a.id = p.article_id
    JOIN analyses an ON an.id = p.analysis_id AND an.article_id = p.article_id AND an.input_revision = a.revision`;
  const scope = sql`p.visibility = 'public' AND p.eligible AND s.participation_mode = 'editorial'
      AND (NOT p.selected OR p.visible_after <= ${now})
      AND an.output->'editorial'->>'kind' IN ('activity_notice', 'activity_registration', 'activity_update')
      ${channelCondition(filters.channel)} ${categoryCondition(filters.category)} ${tagCondition(filters.tag)} ${sourceCondition(filters.sources)}`;
  // Representatives are read separately, so a large group's cap can never truncate the card's own
  // facts. Read at most 100 related notices plus one overflow sentinel per group.
  const bases = await sql<Row[]>`SELECT ${columns} ${from} WHERE p.article_id IN ${sql(ids)} AND p.selected AND ${scope}`;
  const groups = [...new Map(bases.filter((row) => row.story_id !== null || row.fact_id !== null)
    .map((row) => [row.story_id !== null ? `s${row.story_id}` : `f${row.fact_id}`, { story_id: row.story_id, fact_id: row.story_id !== null ? null : row.fact_id }])).values()];
  const relatedRows = groups.length ? await sql<Row[]>`
    SELECT related.* FROM jsonb_to_recordset(${sql.json(groups)}) AS g(story_id bigint, fact_id bigint)
    CROSS JOIN LATERAL (
      SELECT ${columns} ${from}
      WHERE (g.story_id IS NOT NULL AND p.story_id = g.story_id
        OR g.story_id IS NULL AND p.story_id IS NULL AND p.fact_id = g.fact_id)
        AND p.article_id NOT IN ${sql(ids)} AND ${scope}
      ORDER BY coalesce(p.published_at, p.timeline_at) DESC, p.article_id LIMIT 101
    ) related` : [];
  const result = new Map<string, ActivitySchedule>();
  for (const card of cards) {
    const base = bases.find((row) => row.id === card.item.id);
    if (!base?.selected || !card.item.selected) continue;
    const related = relatedRows.filter((row) => base.story_id !== null ? row.story_id === base.story_id
      : base.fact_id !== null && row.story_id === null && row.fact_id === base.fact_id);
    const schedule = related.length > 100 ? review()
      : resolveActivitySchedule(base.editorial, related.map((row) => ({ editorial: row.editorial, at: row.at.getTime() })), base.at.getTime());
    if (schedule) result.set(base.id, schedule);
  }
  return result;
}
