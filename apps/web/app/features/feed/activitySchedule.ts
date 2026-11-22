import type { ActivityScheduleTime } from "@aihot/contracts/site";
import { isValidDate } from "@aihot/contracts/time";

function validTime(time: ActivityScheduleTime): boolean {
  if (!time.value) return true;
  if (!isValidDate(time.value.slice(0, 10))) return false;
  return time.precision === "day" ? time.value.length === 10
    : /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\+08:00$/.test(time.value);
}

/** Source precision survives display; a missing clock never becomes midnight. */
export function activityTimeRange(start: ActivityScheduleTime | undefined, end: ActivityScheduleTime | undefined, kind: "registration" | "activity", year: string, note?: string): string | null {
  if (kind === "registration" && note) {
    if (note === "无需报名") return start || end ? "时间待核实" : note;
    end ??= { text: note, value: null, precision: null };
  }
  if (!start && !end) return null;
  if ([start, end].some((time) => time && !validTime(time))) return "时间待核实";
  if (start?.value && end?.value) {
    const reversed = start.precision === "day" || end.precision === "day"
      ? start.value.slice(0, 10) > end.value.slice(0, 10) : Date.parse(start.value) > Date.parse(end.value);
    if (reversed) return "时间待核实";
  }
  const years = [start?.value?.slice(0, 4), end?.value?.slice(0, 4)].filter(Boolean);
  const showYear = years.some((value) => value !== year);
  const format = (time: ActivityScheduleTime) => {
    if (!time.value) return time.text;
    const date = time.value.slice(showYear ? 0 : 5, 10).replaceAll("-", "/");
    return time.precision === "day" ? date : `${date} ${time.value.slice(11, 16)}`;
  };
  if (start && end) {
    const sameDay = start.value && end.value && start.value.slice(0, 10) === end.value.slice(0, 10);
    if (sameDay && start.precision === "day" && end.precision === "day") return format(start);
    const endText = sameDay && start.precision !== "day" && end.precision !== "day"
      ? end.value!.slice(11, 16) : format(end) + (sameDay && end.precision === "day" ? "（时刻未注明）" : "");
    return `${format(start)} → ${endText}`;
  }
  if (end) return end.value ? kind === "registration" ? `截至 ${format(end)}` : `${format(end)} 结束 · 开始未注明` : end.text;
  const text = format(start!);
  const begins = /^(即日起|今日起|现在起)$/.test(text) ? text : `${text} 开始`;
  return `${begins} · ${kind === "registration" ? "截止" : "结束"}未注明`;
}
