import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActivityScheduleTime } from "@aihot/contracts/site";
import { activityTimeRange } from "../app/features/feed/activitySchedule.ts";

const time = (value: string, precision: ActivityScheduleTime["precision"] = "minute"): ActivityScheduleTime => ({ text: value, value, precision });
const raw = (text: string): ActivityScheduleTime => ({ text, value: null, precision: null });

test("同日仅结束端省略日期，跨日与跨年保留两端日期", () => {
  assert.equal(activityTimeRange(time("2026-11-24T19:00+08:00"), time("2026-11-24T21:00+08:00"), "activity", "2026"), "11/24 19:00 → 21:00");
  assert.equal(activityTimeRange(time("2026-11-24T19:00+08:00"), time("2026-11-25T09:00+08:00"), "activity", "2026"), "11/24 19:00 → 11/25 09:00");
  assert.equal(activityTimeRange(time("2026-12-31", "day"), time("2027-01-02", "day"), "registration", "2026"), "2026/12/31 → 2027/01/02");
  assert.equal(activityTimeRange(time("2025-11-24", "day"), time("2025-11-25", "day"), "activity", "2026"), "2025/11/24 → 2025/11/25");
});

test("日精度不补钟点，同日结束日期不能变成午夜或消失", () => {
  assert.equal(activityTimeRange(time("2026-11-20", "day"), time("2026-11-25", "day"), "registration", "2026"), "11/20 → 11/25");
  assert.equal(activityTimeRange(time("2026-11-24T19:00+08:00"), time("2026-11-24", "day"), "activity", "2026"), "11/24 19:00 → 11/24（时刻未注明）");
});

test("单端点、原文特殊截止和缺失信息不编造范围", () => {
  assert.equal(activityTimeRange(undefined, time("2026-11-25T18:00+08:00"), "registration", "2026"), "截至 11/25 18:00");
  assert.equal(activityTimeRange(time("2026-11-26T19:00+08:00"), undefined, "activity", "2026"), "11/26 19:00 开始 · 结束未注明");
  assert.equal(activityTimeRange(time("2026-11-20", "day"), raw("报满即止"), "registration", "2026"), "11/20 → 报满即止");
  assert.equal(activityTimeRange(raw("即日起"), undefined, "registration", "2026"), "即日起 · 截止未注明");
  assert.equal(activityTimeRange(undefined, undefined, "registration", "2026"), null);
});

test("无法解析或反向时间不展示为可靠日期", () => {
  assert.equal(activityTimeRange(time("2026-02-30", "day"), undefined, "activity", "2026"), "时间待核实");
  assert.equal(activityTimeRange(time("2026-11-25", "day"), time("2026-11-24", "day"), "registration", "2026"), "时间待核实");
  assert.equal(activityTimeRange(raw("周末晚上"), undefined, "activity", "2026"), "周末晚上 开始 · 结束未注明");
});

test("报名说明补充缺失截止端点，与无需报名矛盾时提示核实", () => {
  assert.equal(activityTimeRange(time("2026-11-20", "day"), undefined, "registration", "2026", "报满即止"), "11/20 → 报满即止");
  assert.equal(activityTimeRange(undefined, undefined, "registration", "2026", "无需报名"), "无需报名");
  assert.equal(activityTimeRange(undefined, time("2026-11-25", "day"), "registration", "2026", "无需报名"), "时间待核实");
});
