import assert from "node:assert/strict";
import { test } from "node:test";
import { fromOptimizedProfile, toOptimizedProfile, legacyTopicExtras } from "@aihot/contracts/subscription-onboarding";
import { annotateSubscription as annotate, matchSubscription as match, normalizeSubscriptionProfile as normalize } from "@aihot/backend/publication/subscription-rules";
import { OPTIMIZED_TOPIC_GROUPS } from "@aihot/industry/subscription-onboarding";

const day = "2026-10-25";
function form() { const p = toOptimizedProfile(); p.userIdentity = { degree: "本科生", college: "计算机科学与工程学院", enrollmentYear: "2025" }; return p; }
function message(summary = "面向全校学生，欢迎参加。", source = "计算机科学与工程学院") { return annotate({ title: "人工智能学术报告预告", summary, source }, true); }

test("optimized HTML selections survive conversion and normalization, including its formerly reserved topics", () => {
  const value = form(); value.subscriptionPreferences.topics = [...new Set(OPTIMIZED_TOPIC_GROUPS.flatMap(g => g.subgroups.flatMap(s => [...s.tags])))];
  const converted = fromOptimizedProfile(value);
  const profile = normalize(converted);
  for (const topic of value.subscriptionPreferences.topics) assert.ok(profile.interests.includes(`topic:${topic}`), topic);
  assert.deepEqual(toOptimizedProfile(converted), value);
  const recruitment = annotate({ title: "社团招新通知", summary: "面向全校学生，欢迎参加。", source: "校团委" }, true);
  assert.ok(recruitment.topics.includes("社团招新"));
  assert.notEqual(match(recruitment, profile, day).lane, "excluded");
});

test("explicit group selection expands to its actual supplied leaves; opening a group does not select it", () => {
  const value = form(); value.subscriptionPreferences.followOwnCollege = false;
  assert.equal(match(message(), normalize(fromOptimizedProfile(value)), day).lane, "excluded");
  value.subscriptionPreferences.topicGroups = ["research"];
  const p = normalize(fromOptimizedProfile(value));
  assert.ok(p.interests.includes("topic:AI/机器学习"));
  assert.equal(match(message(), p, day).lane, "matched");
});

test("own-college following is independent of interest and never overrides explicit degree restrictions", () => {
  const p = normalize(fromOptimizedProfile(form()));
  assert.equal(match(message(), p, day).lane, "matched");
  assert.equal(match(message("仅限硕士研究生报名。"), p, day).lane, "excluded");
  assert.equal(match(message(undefined, "自动化学院"), p, day).lane, "excluded");
});

test("identity-all broadens candidates but keeps conflicts, unknown audience and exclusions", () => {
  const value = form(); value.subscriptionPreferences.mode = "identity_all"; value.subscriptionPreferences.followOwnCollege = false;
  let p = normalize(fromOptimizedProfile(value));
  assert.equal(match(message(undefined, "自动化学院"), p, day).lane, "matched");
  assert.equal(match(message("仅限硕士研究生报名。"), p, day).lane, "excluded");
  assert.equal(match(message("欢迎参加。"), p, day).lane, "possible");
  value.subscriptionPreferences.excludedContentTypes = ["活动预告"];
  p = normalize(fromOptimizedProfile(value));
  assert.equal(match(message(), p, day).lane, "excluded");
});

test("offline exclusion uses canonical campus IDs, allows online, and keeps ambiguous multiple sites for review", () => {
  const value = form(); value.subscriptionPreferences.excludedLocations = ["丁家桥校区"];
  const p = normalize(fromOptimizedProfile(value));
  assert.deepEqual(p.excludedLocations, ["location:丁家桥"]);
  assert.equal(match(message("面向全校学生。地点：丁家桥校区。"), p, day).lane, "excluded");
  assert.equal(match(message("面向全校学生。丁家桥校区组织，线上腾讯会议参加。"), p, day).lane, "matched");
  assert.equal(match(message("面向全校学生。丁家桥校区及九龙湖校区均有会场。"), p, day).lane, "possible");
  assert.equal(match(message(), p, day).lane, "possible");
});

test("type exclusions still apply to online events and all excluded known types cannot enter", () => {
  const value = form(); value.subscriptionPreferences.excludedLocations = ["丁家桥校区"]; value.subscriptionPreferences.excludedContentTypes = ["活动预告"];
  const p = normalize(fromOptimizedProfile(value));
  assert.equal(match(message("面向全校学生，丁家桥校区组织线上腾讯会议。"), p, day).lane, "excluded");
});

test("legacy settings remain valid; saved topics missing from the supplied demo remain editable", () => {
  const legacy = normalize({ degree: "本科生", interests: ["topic:校科协"], identityNotices: true, international: "no", types: ["type:事务通知"] });
  assert.equal(legacy.mode, undefined);
  const converted = fromOptimizedProfile(toOptimizedProfile(legacy), legacy);
  assert.deepEqual(converted.interests, legacy.interests); assert.equal(converted.international, "no");
  assert.ok(!converted.excludedTypes!.includes("type:事务通知"));
  assert.ok(converted.excludedTypes!.includes("type:新闻报道"));
  const withExtra = toOptimizedProfile({ ...legacy, interests: ["topic:社团联合会"] });
  assert.ok(legacyTopicExtras(withExtra).some(g => g.tags.includes("社团联合会")));
});

test("bridge conversion rejects malformed data and missing identity instead of silently losing selections", () => {
  assert.throws(() => fromOptimizedProfile(null)); assert.throws(() => fromOptimizedProfile(toOptimizedProfile()));
  const value = form(); value.subscriptionPreferences.topics = ["不存在的标签"];
  assert.throws(() => fromOptimizedProfile(value), /兴趣/);
  value.subscriptionPreferences.topics = []; value.userIdentity.college = "自定义学院";
  assert.throws(() => fromOptimizedProfile(value), /学院/);
});
