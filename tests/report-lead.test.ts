// A daily's front-page picture comes from the item its lead is about: the editors' lead matched to an
// item by title, never simply the first highlight.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReportCitation } from "@aihot/contracts/site";
import { leadItemOf } from "@aihot/backend/publication/reports";

const cite = (itemId: string, title: string) => ({ itemId, title }) as ReportCitation;
const arena = cite("a", "校团委发布暑期社会实践优秀团队评选结果公示");
const jwc = cite("b", "教务处发布 2026-2027 学年秋季学期选课安排，改选截止 9 月 12 日");

test("an editors' lead is matched to the item it is written about", () => {
  assert.equal(leadItemOf("教务处发布秋季学期选课安排，改选 9 月 12 日截止", [arena, jwc], [arena, jwc])?.itemId, "b");
});

test("a lead that matches no item clearly has no item", () => {
  assert.equal(leadItemOf("本周校内通知较多，多项安排集中发布", [arena], [arena, jwc]), undefined);
});

test("without an editors' lead the first highlight leads", () => {
  assert.equal(leadItemOf(undefined, [arena], [jwc, arena])?.itemId, "a");
});
