import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COLLEGES } from "../industry/colleges.ts";
import { sourceOrg } from "../industry/source-orgs.ts";

const { sources } = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<{ name: string; tags: string[] }> };

test("简称并到单位全称，栏目名去掉单位前缀", () => {
  assert.deepEqual(sourceOrg("网安·新闻快讯", ["学院与书院"]), { group: "学院与书院", org: "网络空间安全学院", label: "新闻快讯" });
  assert.deepEqual(sourceOrg("信息学院·培养环节通知", ["学院", "信息科学与工程学院"]), { group: "学院与书院", org: "信息科学与工程学院", label: "培养环节通知" });
  assert.equal(sourceOrg("教务处·信息通知", ["机关", "教务处"]).group, "机关与职能部门");
});

test("公众号挂到运营单位，保留公众号字样；其余进合集", () => {
  assert.deepEqual(sourceOrg("公众号·东南大学交通学院", ["公众号", "学院"]), { group: "学院与书院", org: "交通学院", label: "公众号·东南大学交通学院" });
  assert.deepEqual(sourceOrg("公众号·东南大学教务处", ["公众号", "校级"]), { group: "机关与职能部门", org: "教务处", label: "公众号·东南大学教务处" });
  assert.deepEqual(sourceOrg("公众号·东南大学苏州校友会", ["公众号", "校友"]), { group: "公众号", org: "校友会公众号", label: "东南大学苏州校友会" });
  assert.deepEqual(sourceOrg("公众号·SEU辩协", ["公众号", "校级"]), { group: "公众号", org: "社团与艺术团公众号", label: "SEU辩协" });
  assert.deepEqual(sourceOrg("公众号·风雅颂东南", ["公众号", "校级"]), { group: "公众号", org: "社团与艺术团公众号", label: "风雅颂东南" });
  assert.equal(sourceOrg("公众号·IF.Link Community", ["公众号", "IF.Link"]).org, "社团与艺术团公众号");
  // 东南文苑是书院、活动室预约平台，不属于人文学院。
  assert.deepEqual(sourceOrg("公众号·东南文苑", ["公众号", "学院"]), { group: "公众号", org: "校级公众号", label: "东南文苑" });
});

test("学院分组下没有残留的简称，学校名单里的学院都用全称", () => {
  const known = new Set<string>(COLLEGES);
  const extra = new Set(["统计与数据科学学院", "新生学院", "雷恩研究生学院", "蒙纳士大学国际学院", "继续教育学院"]);
  const orgs = new Set(sources.map((s) => sourceOrg(s.name, s.tags)).filter((o) => o.group === "学院与书院").map((o) => o.org));
  assert.deepEqual([...orgs].filter((o) => !known.has(o) && !extra.has(o)), []);
});
