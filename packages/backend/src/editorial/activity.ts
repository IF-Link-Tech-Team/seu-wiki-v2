import { z } from "zod";
import { addDays, beijingDate, isValidDate } from "@aihot/contracts/time";
import { collapseWhitespace } from "../lib/text.ts";
import type { AnalyzeInputArticle } from "./input.ts";

const KINDS = [
  "activity_notice", "activity_registration", "activity_update", "activity_summary",
  "result", "campus_news", "other", "unknown",
] as const;
const TIME_FIELDS = ["registrationStart", "registrationEnd", "activityStart", "activityEnd"] as const;
type TimeField = typeof TIME_FIELDS[number];
const sourceText = z.string().trim().min(1).max(300).nullish().catch(null);
const ActivitySchema = z.object({
  name: sourceText,
  venue: sourceText,
  participation: sourceText,
  registrationStart: sourceText,
  registrationEnd: sourceText,
  activityStart: sourceText,
  activityEnd: sourceText,
});
export const ActivityEditorialSchema = z.object({
  kind: z.enum(KINDS).catch("unknown"),
  evidence: sourceText,
  update: z.enum(["rescheduled", "cancelled", "other"]).nullish().catch(null),
  needsReview: z.boolean().catch(false),
  activities: z.array(ActivitySchema.nullable().catch(null)).max(4).catch([]),
}).nullish().catch(null);

type ActivityTime = {
  evidence: string;
  value: string | null;
  precision: "day" | "minute" | "second" | null;
};
type Activity = {
  name: string;
  venue?: string;
  participation?: string;
} & Partial<Record<TimeField, ActivityTime>>;

const ABSOLUTE_DATE = /^(?:(\d{4})[-年/.])?(\d{1,2})[-月/.](\d{1,2})[日号]?$/;
const CLOCK = /[T\s]*(?:(上午|中午|下午|晚上)\s*)?(\d{1,2}|[一二两三四五六七八九十])(?::(\d{2})(?::(\d{2}))?|[时点](?:(\d{1,2})分?)?)$/;
const WEEKDAY_SUFFIX = /\((?:周|星期)([一二三四五六日天])\)$/;
const WEEKDAY = "一二三四五六日";
const pad = (value: string | number) => String(value).padStart(2, "0");

function resolveDay(text: string, anchor: string | null): string | null {
  const match = ABSOLUTE_DATE.exec(text);
  if (match) {
    const [, year, month, day] = match;
    const dateIn = (y: string | number) => `${y}-${pad(month!)}-${pad(day!)}`;
    if (year) return isValidDate(dateIn(year)) ? dateIn(year) : null;
    if (!anchor) return null;
    // Yearless dates use the closest calendar occurrence to the source date. Ties stay unresolved.
    const y = Number(anchor.slice(0, 4));
    const candidates = [y - 1, y, y + 1].map(dateIn).filter(isValidDate)
      .map((date) => ({ date, days: Math.abs(Date.parse(date) - Date.parse(anchor)) / 86_400_000 }))
      .sort((a, b) => a.days - b.days);
    const closest = candidates[0];
    return closest && closest.days <= 183 && closest.days !== candidates[1]?.days ? closest.date : null;
  }
  if (!anchor) return null;
  if (/^(即日起|今天|今日)$/.test(text)) return anchor;
  if (/^(明天|明日)$/.test(text)) return addDays(anchor, 1);
  if (/^(后天|后日)$/.test(text)) return addDays(anchor, 2);
  const weekday = /^(本|下)(?:周|星期)([一二三四五六日天])$/.exec(text);
  if (!weekday) return null;
  const current = (new Date(anchor).getUTCDay() + 6) % 7;
  const target = WEEKDAY.indexOf(weekday[2]!.replace("天", "日"));
  return addDays(anchor, target - current + (weekday[1] === "下" ? 7 : 0));
}

function resolveTime(evidence: string, anchor: string | null): ActivityTime {
  const text = evidence.normalize("NFKC").trim().replace(/\s*(?:北京时间|\+08:00)$/, "");
  const clock = CLOCK.exec(text);
  const unresolved = { evidence, value: null, precision: null };
  const dayText = clock ? text.slice(0, clock.index).trim() : text;
  const weekday = WEEKDAY_SUFFIX.exec(dayText);
  const date = resolveDay(weekday ? dayText.slice(0, weekday.index).trim() : dayText, anchor);
  if (!date || (weekday && WEEKDAY[(new Date(date).getUTCDay() + 6) % 7] !== weekday[1]!.replace("天", "日"))) return unresolved;
  if (!clock) return { evidence, value: date, precision: "day" };
  const [, period, hourText, colonMinute, second, chineseMinute] = clock;
  let hour = /^\d/.test(hourText!) ? Number(hourText) : "一二三四五六七八九十".indexOf(hourText!.replace("两", "二")) + 1;
  if (period === "下午" || period === "晚上") {
    if (hour === 0 || (period === "晚上" && hour === 12)) return unresolved;
    if (hour < 12) hour += 12;
  }
  if ((period === "上午" && hour >= 12) || (period === "中午" && (hour < 11 || hour > 13))) return unresolved;
  const minute = Number(colonMinute ?? chineseMinute ?? "0");
  if (hour > 23 || minute > 59 || Number(second ?? "0") > 59) return unresolved;
  return { evidence, value: `${date}T${pad(hour)}:${pad(minute)}${second ? `:${second}` : ""}+08:00`, precision: second ? "second" : "minute" };
}

function normalizeRange(source: string[], start?: ActivityTime, end?: ActivityTime) {
  if (!start?.value || !end) return;
  if (!end.value && source.some((text) => text.split(start.evidence).slice(1).some((tail) => {
    const endAt = tail.indexOf(end.evidence);
    return endAt >= 0 && /^\s*(?:至|到|[-—–~～－]+)\s*$/.test(tail.slice(0, endAt));
  }))) {
    const day = start.value.slice(0, 10);
    const partial = end.evidence.normalize("NFKC");
    const expanded = /^\d{1,2}[日号]/.test(partial) ? `${day.slice(0, 7)}-${partial}`
      : CLOCK.exec(partial)?.index === 0 ? `${day} ${partial}` : null;
    if (expanded) {
      const resolved = resolveTime(expanded, null);
      end.value = resolved.value;
      end.precision = resolved.precision;
    }
  }
  if (!end.value) return;
  const reversed = start.precision === "day" || end.precision === "day"
    ? start.value.slice(0, 10) > end.value.slice(0, 10)
    : Date.parse(start.value) > Date.parse(end.value);
  if (reversed) {
    start.value = end.value = null;
    start.precision = end.precision = null;
  }
}

/** Shadow assessment. Source facts are kept private in analyses.output until the publication cutover. */
export function normalizeActivityEditorial(raw: z.infer<typeof ActivityEditorialSchema>, article: AnalyzeInputArticle) {
  if (!raw) return null;
  const body = collapseWhitespace(article.xPost ? String(article.xPost.text ?? "") : article.bodyText ?? article.excerpt ?? "");
  const source = [collapseWhitespace(article.title), body];
  const verified = (value: string | null | undefined) => {
    const quote = collapseWhitespace(value ?? "");
    return quote && source.some((text) => text.includes(quote)) ? quote : null;
  };
  const evidence = verified(raw.evidence);
  const kind = evidence ? raw.kind : "unknown";
  const candidateType = kind === "activity_notice" || kind === "activity_registration";
  const anchor = article.publishedAt ? beijingDate(article.publishedAt) : null;
  const activities: Activity[] = [];
  if (raw.kind === "activity_notice" || raw.kind === "activity_registration" || raw.kind === "activity_update") {
    for (const item of raw.activities) {
      if (!item) continue;
      const name = verified(item.name);
      if (!name) continue;
      const activity: Activity = { name };
      const venue = verified(item.venue);
      const participation = verified(item.participation);
      if (venue) activity.venue = venue;
      if (participation) activity.participation = participation;
      for (const field of TIME_FIELDS) {
        const quote = verified(item[field]);
        if (quote) activity[field] = resolveTime(quote, anchor);
      }
      // Some models expand a shared date onto the range end. Accept only the actual source clock,
      // with an adjacent range separator and an identical resolved timestamp to prove the date.
      for (const [startField, endField] of [["registrationStart", "registrationEnd"], ["activityStart", "activityEnd"]] as const) {
        const proposed = item[endField];
        const start = activity[startField];
        if (activity[endField] || !proposed || !start?.value) continue;
        const clock = CLOCK.exec(proposed.normalize("NFKC"));
        if (!clock || clock.index === 0) continue;
        const quote = verified(proposed.slice(clock.index).trim());
        if (!quote) continue;
        const end = resolveTime(quote, anchor);
        normalizeRange(source, { ...start }, end);
        if (end.value && end.value === resolveTime(proposed, anchor).value) activity[endField] = end;
      }
      normalizeRange(source, activity.registrationStart, activity.registrationEnd);
      normalizeRange(source, activity.activityStart, activity.activityEnd);
      activities.push(activity);
    }
  }
  const actionable = activities.some((item) => item.participation || item.activityStart?.value || item.registrationStart?.value || item.registrationEnd?.value);
  const decision = candidateType && actionable && body && !raw.needsReview ? "candidate"
    : candidateType || kind === "activity_update" || kind === "unknown" ? "review"
    : "excluded";
  return { kind, evidence, decision, activities, ...(kind === "activity_update" && raw.update ? { update: raw.update } : {}) };
}
