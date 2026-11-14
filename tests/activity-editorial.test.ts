import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityEditorialSchema, normalizeActivityEditorial } from "@aihot/backend/editorial/activity";
import type { AnalyzeInputArticle } from "@aihot/backend/editorial/input";

function material(bodyText: string, publishedAt: string | null = "2026-11-08T14:00:00+08:00"): AnalyzeInputArticle {
  return {
    id: "test", revision: 1, title: "校园活动信息", author: null, url: "https://example.invalid/activity",
    publishedAt: publishedAt ? new Date(publishedAt) : null, bodyText, excerpt: null, xPost: null, media: [],
    source: { name: "演示信源", kind: "rss", tier: "T1" },
  };
}

const analyze = (raw: unknown, article: AnalyzeInputArticle) => normalizeActivityEditorial(ActivityEditorialSchema.parse(raw), article);

test("活动报名分别提取报名起止和活动开始，保留日期精度", () => {
  const body = "开放志愿活动报名。报名时间即日起至11月15日。活动于11月20日 19:30开始。";
  const result = analyze({
    kind: "activity_registration", evidence: "开放志愿活动报名",
    activities: [{ name: "志愿活动", registrationStart: "即日起", registrationEnd: "11月15日", activityStart: "11月20日 19:30" }],
  }, material(body));
  assert.equal(result?.decision, "candidate");
  assert.deepEqual(result?.activities[0], {
    name: "志愿活动",
    registrationStart: { evidence: "即日起", value: "2026-11-08", precision: "day" },
    registrationEnd: { evidence: "11月15日", value: "2026-11-15", precision: "day" },
    activityStart: { evidence: "11月20日 19:30", value: "2026-11-20T19:30+08:00", precision: "minute" },
  });
});

test("以可信发布时间换算跨年和明确的相对日期", () => {
  const raw = {
    kind: "activity_notice", evidence: "读书会预告",
    activities: [{ name: "读书会", registrationStart: "明天", registrationEnd: "1月2日", activityStart: "下周一 18:00" }],
  };
  const body = "读书会预告：明天开始报名，1月2日截止，下周一 18:00见。";
  const result = analyze(raw, material(body, "2026-12-30T23:00:00+08:00"));
  assert.equal(result?.activities[0]?.registrationStart?.value, "2026-12-31");
  assert.equal(result?.activities[0]?.registrationEnd?.value, "2027-01-02");
  assert.equal(result?.activities[0]?.activityStart?.value, "2027-01-04T18:00+08:00");
  const withoutAnchor = analyze(raw, material(body, null));
  assert.equal(withoutAnchor?.decision, "review");
  assert.equal(withoutAnchor?.activities[0]?.registrationEnd?.value, null);
});

test("公示、总结、校园新闻和一般事务即使包含活动时间也不成为候选", () => {
  for (const kind of ["result", "activity_summary", "campus_news", "other"]) {
    const result = analyze({
      kind, evidence: "原文片段", activities: [{ name: "讲座", activityStart: "11月20日" }],
    }, material("原文片段：讲座曾于11月20日安排。"));
    assert.equal(result?.decision, "excluded");
    assert.deepEqual(result?.activities, []);
  }
});

test("证据不足、附件待核验及取消通知不产生新候选", () => {
  const body = "讲座预告。活动安排详见海报。讲座取消。";
  const candidate = { kind: "activity_notice", evidence: "讲座预告", activities: [{ name: "讲座", activityStart: "2026-11-20" }] };
  assert.equal(analyze(candidate, material(body))?.decision, "review", "捏造的日期被丢弃");
  assert.equal(analyze({ ...candidate, evidence: "伪造预告" }, material(body))?.decision, "review");
  assert.equal(analyze({ ...candidate, needsReview: true, activities: [{ name: "讲座", participation: "活动安排详见海报" }] }, material(body))?.decision, "review");
  const update = analyze({ kind: "activity_update", evidence: "讲座取消", update: "cancelled", activities: [{ name: "讲座" }] }, material(body));
  assert.equal(update?.decision, "review");
  assert.equal(update?.update, "cancelled");
});

test("时间倒置时保留两端原文，不影响其他场次的可用信息", () => {
  const result = analyze({
    kind: "activity_registration", evidence: "开放报名",
    activities: [
      { name: "第一场", registrationStart: "11月18日", registrationEnd: "11月16日" },
      { name: "第二场", activityStart: "2026年11月22日14点30分", activityEnd: "2026年11月22日16:00" },
    ],
  }, material("开放报名。第一场11月18日开放、11月16日截止。第二场2026年11月22日14点30分到2026年11月22日16:00。"));
  assert.equal(result?.decision, "candidate");
  assert.deepEqual(result?.activities[0]?.registrationEnd, { evidence: "11月16日", value: null, precision: null });
  assert.equal(result?.activities[1]?.activityStart?.value, "2026-11-22T14:30+08:00");
  assert.equal(result?.activities[1]?.activityEnd?.value, "2026-11-22T16:00+08:00");
});

test("非法日期留待核验，只有日期且原文无正文时不能入选", () => {
  const raw = { kind: "activity_notice", evidence: "讲座预告", activities: [{ name: "讲座", activityStart: "2026年2月30日" }] };
  const result = analyze(raw, material("讲座预告：2026年2月30日举行。"));
  assert.equal(result?.decision, "review");
  assert.equal(result?.activities[0]?.activityStart?.value, null);
  const article = { ...material(""), title: "讲座预告：2026年11月20日" };
  assert.equal(analyze({ ...raw, activities: [{ name: "讲座", activityStart: "2026年11月20日" }] }, article)?.decision, "review");
  assert.equal(analyze(undefined, article), null);
});

test("同一原文区间内可承接月份和日期，分开的时间仍待核验", () => {
  const result = analyze({
    kind: "activity_registration", evidence: "开放报名",
    activities: [{
      name: "讲座", registrationStart: "11月12日", registrationEnd: "15日",
      activityStart: "11月22日14:30", activityEnd: "16:00",
    }],
  }, material("讲座开放报名，11月12日至15日；活动时间为11月22日14:30—16:00。"));
  assert.equal(result?.activities[0]?.registrationEnd?.value, "2026-11-15");
  assert.deepEqual(result?.activities[0]?.activityEnd, { evidence: "16:00", value: "2026-11-22T16:00+08:00", precision: "minute" });
  const separate = analyze({
    kind: "activity_notice", evidence: "讲座预告",
    activities: [{ name: "讲座", activityStart: "11月22日14:30", activityEnd: "16:00" }],
  }, material("讲座预告：11月22日14:30开始。另有会议16:00开始。"));
  assert.equal(separate?.activities[0]?.activityEnd?.value, null);
});

test("活动通知里的星期括注、时段和中文钟点按原文换算", () => {
  const body = "体验课开放报名。11月8日（周日）19:00–21:00；11月9日（周一）中午12:30开放报名。另有手作活动：11月15日下午两点。公开讲座：2026年11月13日（周五）下午18:30-20:30。";
  const result = analyze({ kind: "activity_registration", evidence: "体验课开放报名", activities: [
    { name: "体验课", activityStart: "11月8日（周日）19:00", activityEnd: "21:00", registrationStart: "11月9日（周一）中午12:30" },
    { name: "手作活动", activityStart: "11月15日下午两点" },
    { name: "公开讲座", activityStart: "2026年11月13日（周五）下午18:30", activityEnd: "20:30" },
  ] }, material(body));
  const times = result?.activities;
  assert.equal(times?.[0]?.activityStart?.value, "2026-11-08T19:00+08:00");
  assert.equal(times?.[0]?.activityEnd?.value, "2026-11-08T21:00+08:00");
  assert.equal(times?.[0]?.registrationStart?.value, "2026-11-09T12:30+08:00");
  assert.equal(times?.[1]?.activityStart?.value, "2026-11-15T14:00+08:00");
  assert.equal(times?.[2]?.activityStart?.value, "2026-11-13T18:30+08:00");
  assert.equal(times?.[2]?.activityEnd?.value, "2026-11-13T20:30+08:00");
});

test("星期和日期冲突时，保留原文等待核验", () => {
  const result = analyze({ kind: "activity_notice", evidence: "讲座预告", activities: [
    { name: "讲座", activityStart: "2026年11月13日（周四）19:00" },
  ] }, material("讲座预告：2026年11月13日（周四）19:00"));
  assert.equal(result?.decision, "review");
  assert.deepEqual(result?.activities[0]?.activityStart, { evidence: "2026年11月13日（周四）19:00", value: null, precision: null });
});

test("结束端点补写的日期只有在原文连续区间可证实时才恢复为原文钟点", () => {
  const raw = { kind: "activity_notice", evidence: "讲座预告", activities: [
    { name: "讲座", activityStart: "2026-11-09 15:00", activityEnd: "2026-11-09 16:00" },
  ] };
  const body = "讲座预告：2026-11-09 15:00-16:00。";
  assert.deepEqual(analyze(raw, material(body))?.activities[0]?.activityEnd,
    { evidence: "16:00", value: "2026-11-09T16:00+08:00", precision: "minute" });
  raw.activities[0]!.activityEnd = "2026-11-10 16:00";
  assert.equal(analyze(raw, material(body))?.activities[0]?.activityEnd, undefined, "补错日期不能恢复");
  raw.activities[0]!.activityEnd = "2026-11-09 16:00";
  assert.equal(analyze(raw, material("讲座预告：2026-11-09 15:00开始，另一个活动16:00开始。"))?.activities[0]?.activityEnd, undefined);
});

test("分类证据无效时仍保留单独核验过的活动时间，整条保持待核验", () => {
  const out = analyze({ kind: "activity_notice", evidence: "不在原文中的概括", activities: [
    { name: "讲座", activityStart: "2026-11-09 15:00" },
  ] }, material("讲座预告：2026-11-09 15:00开讲。"));
  assert.equal(out?.kind, "unknown");
  assert.equal(out?.decision, "review");
  assert.equal(out?.activities[0]?.activityStart?.value, "2026-11-09T15:00+08:00");
});
