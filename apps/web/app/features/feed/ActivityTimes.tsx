import { useState } from "react";
import type { ActivitySchedule, ActivityScheduleEntry } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { IconChevronDown } from "../../components/icons";
import { activityTimeRange } from "./activitySchedule";

type PaperTone = "amber" | "green" | "cancelled";

const TONE_CLASS: Record<PaperTone, string> = {
  amber: "paper-note-amber",
  green: "paper-note-green",
  cancelled: "paper-note-cancelled",
};

interface ResolvedActivity {
  name: string;
  event: string | null;
  registration: string | null;
}

function resolveActivities(schedule: ActivitySchedule, year: string): ResolvedActivity[] {
  const out: ResolvedActivity[] = [];
  for (const activity of schedule.activities) {
    const rawEvent = activityTimeRange(activity.activityStart, activity.activityEnd, "activity", year);
    const rawRegistration = activityTimeRange(activity.registrationStart, activity.registrationEnd, "registration", year, activity.registrationNote);
    const event = rawEvent && rawEvent !== "时间待核实" ? rawEvent : null;
    const registration = rawRegistration && rawRegistration !== "时间待核实" ? rawRegistration : null;
    if (event || registration) out.push({ name: activity.name, event, registration });
  }
  return out;
}

/** Whether the card actually has a visible schedule block (pending / unverified notices stay hidden). */
export function hasVisibleActivitySchedule(schedule: ActivitySchedule | null | undefined): boolean {
  if (!schedule) return false;
  if (schedule.notice) return schedule.notice === "活动已取消";
  const year = beijingDate(Date.now()).slice(0, 4);
  return resolveActivities(schedule, year).length > 0;
}

function PaperNotePill({ tone, label, text }: { tone: PaperTone; label: string; text: string }) {
  return (
    <div className={`paper-note ${TONE_CLASS[tone]} inline-flex max-w-full flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-1.5`}>
      <span className="paper-tag inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-[0.02em] leading-4">
        {label}
      </span>
      <span className="num text-[13px] font-semibold leading-5 wrap-anywhere">{text}</span>
    </div>
  );
}

function ActivityBlock({ activity, named }: { activity: ResolvedActivity; named: boolean }) {
  return (
    <div className="min-w-0 space-y-1.5">
      {named && <p className="text-[12.5px] font-semibold text-ink-2 wrap-anywhere">{activity.name}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {activity.event && <PaperNotePill tone="green" label="活动" text={activity.event} />}
        {activity.registration && <PaperNotePill tone="amber" label="报名" text={activity.registration} />}
      </div>
    </div>
  );
}

export function ActivityTimes({ schedule }: { schedule: ActivitySchedule }) {
  const [expanded, setExpanded] = useState(false);
  if (schedule.notice) {
    if (schedule.notice !== "活动已取消") return null;
    return (
      <div className="min-w-0 max-w-full space-y-2" aria-label="活动时间">
        <div className="flex flex-wrap items-center gap-2">
          <PaperNotePill tone="cancelled" label="变动" text="活动已取消" />
        </div>
      </div>
    );
  }
  const year = beijingDate(Date.now()).slice(0, 4);
  const activities = resolveActivities(schedule, year);
  if (!activities.length) return null;
  const hiddenCount = Math.max(0, activities.length - 1);

  return (
    <div className="min-w-0 max-w-full space-y-2" aria-label="活动与报名时间">
      <div className="space-y-2.5">
        {(expanded ? activities : activities.slice(0, 1)).map((activity, index) => (
          <ActivityBlock key={`${index}-${activity.name}`} activity={activity} named={activities.length > 1} />
        ))}
      </div>
      {hiddenCount > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="paper-toggle relative z-10 inline-flex min-h-11 lg:min-h-8 items-center gap-1.5 px-3 py-1 text-[12.5px] font-medium"
          >
            <span>{expanded ? "收起场次" : `展开其余 ${hiddenCount} 场`}</span>
            <IconChevronDown size={13} className={`transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      )}
    </div>
  );
}
