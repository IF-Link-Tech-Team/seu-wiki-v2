import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const html = readFileSync(new URL("../app/features/subscription/optimized-profile.html", import.meta.url), "utf8");
const script = html.slice(html.indexOf("      function bindCollegePicker("), html.indexOf("      function selectedTopicChips("));
const colleges = ["机械工程学院", "计算机科学与工程学院", "吴健雄学院", "医学院", "公共卫生学院"];

function picker(multiple = true, followed: string[] = []) {
  const listeners = new Map<string, (event: any) => void>();
  const attributes = new Map<string, string>();
  const input = { value: "", setAttribute: (key: string, value: string) => attributes.set(key, value), removeAttribute: (key: string) => attributes.delete(key),
    focus() {}, addEventListener: (name: string, handler: any) => listeners.set(name, handler) };
  const options = { hidden: true, innerHTML: "", addEventListener: (name: string, handler: any) => listeners.set(`options:${name}`, handler), querySelectorAll: () => [] };
  const profile = { userIdentity: { college: "吴健雄学院" }, subscriptionPreferences: { followedColleges: [...followed] } };
  let renders = 0;
  runInNewContext(script + '\nbindCollegePicker("search", "options", multiple);', {
    profile, colleges, multiple, followCollegeQuery: "", esc: (value: string) => value,
    renderStep1: () => renders++, document: { getElementById: (id: string) => id === "options" ? options : input },
  });
  const fire = (name: string, event = {}) => listeners.get(name)?.({ preventDefault() {}, ...event });
  return { profile, input, options, attributes, fire, renders: () => renders,
    type(value: string) { input.value = value; fire("input"); },
    choose(value: string) { fire("options:click", { target: { closest: () => ({ dataset: { college: value } }) } }); } };
}

test("Chinese keyword survives blur; only choosing a canonical option adds a college", () => {
  const h = picker();
  h.type("机械");
  assert.match(h.options.innerHTML, /机械工程学院/);
  assert.doesNotMatch(h.options.innerHTML, /计算机科学/);
  assert.equal(h.renders(), 0);
  h.fire("change"); h.fire("blur");
  assert.equal(h.input.value, "机械");
  assert.deepEqual(h.profile.subscriptionPreferences.followedColleges, []);
  h.choose("机械工程学院");
  assert.deepEqual(h.profile.subscriptionPreferences.followedColleges, ["机械工程学院"]);
});

test("IME confirmation does not select early; Enter selects a unique completed result", () => {
  const h = picker();
  h.fire("compositionstart"); h.type("计算机");
  assert.equal(h.options.hidden, true);
  h.fire("keydown", { key: "Enter", isComposing: true });
  assert.equal(h.renders(), 0);
  h.fire("compositionend");
  assert.equal(h.options.hidden, false);
  h.fire("keydown", { key: "Enter" });
  assert.deepEqual(h.profile.subscriptionPreferences.followedColleges, ["计算机科学与工程学院"]);
});

test("own college, duplicates, unknown names and selections above the limit are rejected", () => {
  const h = picker(true, ["机械工程学院"]);
  h.type("学院");
  assert.doesNotMatch(h.options.innerHTML, /吴健雄学院|机械工程学院/);
  h.choose("机械工程学院"); h.choose("吴健雄学院"); h.choose("机院");
  assert.equal(h.profile.subscriptionPreferences.followedColleges.length, 1);
  const full = picker(true, Array.from({ length: 10 }, (_, i) => `学院${i}`));
  full.choose("机械工程学院");
  assert.equal(full.profile.subscriptionPreferences.followedColleges.length, 10);
});

test("empty and unmatched queries never select stale results; ambiguous Enter waits for a choice", () => {
  const h = picker();
  h.type("机械"); h.type(""); h.fire("keydown", { key: "Enter" });
  h.type("不存在");
  assert.match(h.options.innerHTML, /没有匹配/);
  h.fire("keydown", { key: "Enter" });
  h.type("学院"); h.fire("keydown", { key: "Enter" });
  assert.equal(h.renders(), 0);
});

test("selecting own college uses the canonical name and removes a duplicate follow", () => {
  const h = picker(false, ["机械工程学院"]);
  h.type("机械"); h.choose("机械工程学院");
  assert.equal(h.profile.userIdentity.college, "机械工程学院");
  assert.deepEqual(Array.from(h.profile.subscriptionPreferences.followedColleges), []);
});
