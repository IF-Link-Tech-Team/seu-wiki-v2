import assert from "node:assert/strict";
import { test } from "node:test";
import type { SourceOption } from "@aihot/contracts/site";
import { groupSourceOptions, matchSourceOrgs, selectedSourceChips } from "../app/features/feed/sourceOrgs.ts";

const opt = (id: string, name: string, org: string, label: string, group: string | null = "学院与书院"): SourceOption => ({ id, name, org, label, group });
const options = [
  opt("x1", "信息学院·培养环节通知", "信息科学与工程学院", "培养环节通知"),
  opt("t1", "交通·信息公告", "交通学院", "信息公告"),
  opt("t2", "交通学院·科研通知", "交通学院", "科研通知"),
  opt("t3", "交通学院·科研通知", "交通学院", "科研通知"),
  opt("j1", "教务处·信息通知", "教务处", "信息通知", "机关与职能部门"),
  opt("q1", "其他·栏目", "未分组单位", "栏目", null),
];

test("同一学院归成一项，分组内按拼音排序，同名栏目合并", () => {
  const orgs = groupSourceOptions(options);
  assert.deepEqual(orgs.map((o) => o.org), ["交通学院", "信息科学与工程学院", "教务处", "未分组单位"]);
  assert.deepEqual(orgs[0]!.rows.map((r) => [r.label, r.ids]), [["信息公告", ["t1"]], ["科研通知", ["t2", "t3"]]]);
  assert.equal(orgs[3]!.group, "其他");
});

test("搜索命中单位名保留全部栏目，命中栏目只留该栏目", () => {
  const orgs = groupSourceOptions(options);
  assert.equal(matchSourceOrgs(orgs, "交通学院")[0]!.rows.length, 2);
  assert.deepEqual(matchSourceOrgs(orgs, "培养环节").map((o) => o.org), ["信息科学与工程学院"]);
  assert.equal(matchSourceOrgs(orgs, "不存在").length, 0);
});

test("整单位选中时 chip 合成一个，部分选中逐行显示", () => {
  const orgs = groupSourceOptions(options);
  assert.deepEqual(selectedSourceChips(orgs, ["t1", "t2", "t3"]).map((c) => c.label), ["交通学院·全部"]);
  assert.deepEqual(selectedSourceChips(orgs, ["t1", "x1", "gone"]), [
    { label: "交通·信息公告", ids: ["t1"] },
    { label: "信息学院·培养环节通知", ids: ["x1"] },
    { label: "gone", ids: ["gone"] },
  ]);
});
