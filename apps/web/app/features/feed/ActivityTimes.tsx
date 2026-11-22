import { useState } from "react";
import type { ActivitySchedule, ActivityScheduleEntry } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { activityTimeRange } from "./activitySchedule";

function ActivityRows({ activity, named, year }: { activity: ActivityScheduleEntry; named: boolean; year: string }) {
  const registration = activityTimeRange(activity.registrationStart, activity.registrationEnd, "registration", year, activity.registrationNote);
  const event = activityTimeRange(activity.activityStart, activity.activityEnd, "activity", year);
  return (
    <div className="min-w-0">
      {named && <p className="mb-1 font-medium text-ink-2 wrap-anywhere">{activity.name}</p>}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
        {registration && <><dt className="font-medium text-accent-ink">报名</dt><dd className="num wrap-anywhere">{registration}</dd></>}
        {event && <><dt className="font-medium text-accent-ink">活动</dt><dd className="num wrap-anywhere">{event}</dd></>}
      </dl>
    </div>
  );
}

export function ActivityTimes({ schedule }: { schedule: ActivitySchedule }) {
  const [expanded, setExpanded] = useState(false);
  const year = beijingDate(Date.now()).slice(0, 4);
  const activities = schedule.activities;
  if (!schedule.notice && !activities.length) return null;
  return (
    <div className="min-w-0 max-w-full space-y-3 rounded-control border border-accent/15 bg-accent-softer px-3 py-2.5 text-[13px] leading-5 text-ink-2" aria-label="报名与活动时间">
      {schedule.notice ? <p>{schedule.notice}</p> : <>
        {(expanded ? activities : activities.slice(0, 2)).map((activity, index) => <ActivityRows key={`${index}-${activity.name}`} activity={activity} named={activities.length > 1} year={year} />)}
        {activities.length > 2 && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="relative z-10 -ml-2 inline-flex min-h-11 items-center rounded-control px-2 text-accent hover:bg-accent-softer">
          {expanded ? "收起场次" : `展开其余 ${activities.length - 2} 场`}
        </button>}
      </>}
    </div>
  );
}
