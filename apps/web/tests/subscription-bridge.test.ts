import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import { transformWithOxc } from "vite";

const channel = "seu-optimized-onboarding-v1";
// Execute the actual component with controlled hook timing: the SSR iframe has already
// fired both load and ready before React effects attach. No browser/network required.
async function parentHarness(onComplete: (value: unknown) => Promise<void>) {
  const effects: Array<() => () => void> = [];
  const refs: Array<{ current: any }> = [];
  const sent: any[] = [];
  const intervals = new Map<number, () => void>();
  let listener: ((event: any) => void) | undefined;
  let acknowledged = false;
  const child = { postMessage: (value: any) => sent.push(value) };
  const modules: Record<string, any> = {
    react: {
      useRef: (current: any) => { const ref = { current }; refs.push(ref); return ref; },
      useState: () => [false, (value: boolean) => { acknowledged = value; }],
      useCallback: (callback: any) => callback,
      useEffect: (effect: any) => effects.push(effect),
    },
    "react/jsx-runtime": { jsx: () => null, jsxs: () => null },
    "@aihot/contracts/subscription-onboarding": {
      toOptimizedProfile: (value: unknown) => value, legacyTopicExtras: () => [],
      fromOptimizedProfile: (value: unknown) => value,
    },
    "./optimized-profile.html?raw": { default: "" },
  };
  const exports: any = {};
  const source = readFileSync(new URL("../app/features/subscription/OptimizedOnboarding.tsx", import.meta.url), "utf8");
  const { code } = await transformWithOxc(source.replace(/^import .*$/gm, "").replace("export function OptimizedOnboarding", "function OptimizedOnboarding"), "OptimizedOnboarding.tsx", { jsx: { runtime: "classic", pragma: "jsx" } });
  runInNewContext(code + "\nexports.OptimizedOnboarding = OptimizedOnboarding;", {
    ...modules.react, ...modules["@aihot/contracts/subscription-onboarding"], html: "", jsx: () => null,
    exports, crypto: { randomUUID: () => "session-token" },
    window: { addEventListener: (_: string, fn: any) => { listener = fn; }, removeEventListener: () => { listener = undefined; } },
    setInterval: (fn: () => void) => { intervals.set(1, fn); return 1; },
    clearInterval: (id: number) => intervals.delete(id),
  });
  exports.OptimizedOnboarding({ initialProfile: null, onComplete });
  refs[0].current = { contentWindow: child };
  const cleanup = effects[0]();
  return { sent, intervals, cleanup, acknowledged: () => acknowledged,
    receive: (type: string, overrides: any = {}) => listener?.({ source: child, origin: "null", data: { channel, type, token: "session-token", profile: { degree: "本科生" } }, ...overrides }) };
}

test("hydration after iframe load still initializes, retries, and waits for a valid acknowledgement", async () => {
  const h = await parentHarness(async () => {});
  assert.equal(h.sent[0].type, "init", "must initialize without a load or ready event");
  assert.equal(h.acknowledged(), false);
  h.intervals.get(1)!();
  assert.equal(h.sent.length, 2);
  h.receive("initialized", { origin: "https://untrusted.example" });
  assert.equal(h.acknowledged(), false);
  h.receive("initialized");
  assert.equal(h.acknowledged(), true);
  assert.equal(h.intervals.size, 0);
  h.cleanup();
});

test("save acknowledges only after persistence, rejects duplicate clicks and permits retry after failure", async () => {
  let finish!: () => void;
  let fail!: (reason: Error) => void;
  let calls = 0;
  const h = await parentHarness(() => { calls++; return new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; }); });
  h.receive("complete", { source: {} });
  assert.equal(calls, 0);
  h.receive("complete"); h.receive("complete");
  assert.equal(calls, 1);
  assert.ok(!h.sent.some(message => message.type === "saved"));
  fail(new Error("database unavailable"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.sent.at(-1).type, "error");
  h.receive("complete");
  assert.equal(calls, 2);
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.sent.at(-1).type, "saved");
  h.cleanup();
});

test("iframe reports missing initialization and repeated init never resets edited selections", () => {
  const html = readFileSync(new URL("../app/features/subscription/optimized-profile.html", import.meta.url), "utf8");
  const script = html.slice(html.indexOf('      const bridgeChannel ='), html.lastIndexOf('      render();'));
  const sent: any[] = [];
  let listener: any;
  let errorText = "";
  const parent = { postMessage: (value: any) => sent.push(value) };
  const button = { disabled: false, textContent: "" };
  const error = { set textContent(value: string) { errorText = value; }, scrollIntoView() {} };
  const context: any = { window: { parent, addEventListener: (_: string, fn: any) => { listener = fn; } },
    document: { getElementById: () => error, querySelector: () => button },
    profile: {}, topicGroups: [], structuredClone, render() {}, stopBubbleMotion() {}, completed: false };
  runInNewContext(script, context);
  context.submitToSubscription();
  assert.match(errorText, /尚未连接/);
  assert.equal(sent.at(-1).type, "ready");
  const init = { source: parent, origin: "https://seu.wiki", data: { channel, type: "init", token: "token", profile: { selection: "original" } } };
  listener(init);
  assert.equal(sent.at(-1).type, "initialized");
  context.profile.selection = "edited";
  listener(init);
  assert.equal(context.profile.selection, "edited");
  context.submitToSubscription();
  assert.equal(sent.at(-1).type, "complete");
  assert.equal(sent.at(-1).profile.selection, "edited");
  listener({ source: parent, origin: "https://seu.wiki", data: { channel, type: "error", token: "token", message: "保存失败" } });
  context.submitToSubscription();
  assert.equal(sent.filter(message => message.type === "complete").length, 2);
});

test("production subscription asks the server for the current live window and exposes no trial UI", () => {
  const source = readFileSync(new URL("../app/routes/subscription.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /2026-10-25|DEFAULT_REPLAY_DAY|我的订阅 · 本地测试|本地试验|回放截止日|导出测试反馈|测试方式与遗漏检查/);
  assert.match(source, /JSON\.stringify\(\{profile,lane,page,q:query\}\)/);
  assert.match(source, /消息范围/);
  assert.doesNotMatch(source, /查看匹配依据|item\.reasons\.map|data\.quality|条件明确/);
});

test("topic bubbles distinguish whole-group selection from expansion and retain quick selections when advancing", () => {
  const html = readFileSync(new URL("../app/features/subscription/optimized-profile.html", import.meta.url), "utf8");
  const gestures = html.slice(html.indexOf("      const pendingGroupSelections"), html.indexOf("      function matchesGroup"));
  const navigation = html.slice(html.indexOf("      function bindCommon"), html.indexOf("      function render()"));
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, (event?: unknown) => void>();
  const preferences = { topicGroups: [] as string[], topics: [] as string[] };
  const expanded = new Set<string>();
  const repacks: boolean[] = [];
  const scrollBehaviors: string[] = [];
  let bubbleTop = 940;
  const viewport = {
    scrollY: 900,
    innerHeight: 700,
    scrollTo({ top, behavior }: { top: number; behavior: string }) {
      scrollBehaviors.push(behavior);
      this.scrollY = top;
    },
  };
  const bubble = {
    dataset: { selectGroup: "further" },
    getBoundingClientRect: () => ({ top: bubbleTop - viewport.scrollY, bottom: bubbleTop - viewport.scrollY + 120 }),
  };
  let sequence = 0;
  const element = (selector: string) => ({
    addEventListener: (_type: string, listener: (event?: unknown) => void) => listeners.set(selector, listener),
  });
  runInNewContext(gestures + navigation + "\nbindTopicActions(); bindCommon();", {
    step: 2,
    profile: { subscriptionPreferences: preferences },
    document: {
      getElementById: element,
      querySelector: element,
      querySelectorAll: (selector: string) => selector.startsWith("#topic-content") ? [bubble] : [],
    },
    setTimeout: (callback: () => void) => { timers.set(++sequence, callback); return sequence; },
    clearTimeout: (timer: number) => timers.delete(timer),
    toggleValue: (values: string[], value: string) => values.includes(value) ? values.filter(v => v !== value) : [...values, value],
    toggleTopicGroup: (id: string) => { if (!expanded.delete(id)) expanded.add(id); return true; },
    refreshTopicChoices(repack: boolean) {
      repacks.push(repack);
      bubbleTop += 50;
      if (repack) viewport.scrollY = 0; // A layout rebuild can temporarily clamp the scroll position.
    },
    validateRequiredIdentity: () => true, render() {}, window: viewport,
  });
  const click = (dataset: Record<string, string>, detail = 1) =>
    listeners.get("topic-content")!({ detail, target: { closest: () => ({ dataset }) } });
  const settle = () => { for (const [id, callback] of timers) { timers.delete(id); callback(); } };
  click({ selectGroup: "further" });
  settle();
  assert.deepEqual([...preferences.topicGroups], ["further"]);
  assert.deepEqual(repacks, [false]);
  assert.equal(bubble.getBoundingClientRect().top, 40);
  click({ selectGroup: "further" });
  click({ selectGroup: "further" }, 2);
  settle();
  assert.equal(expanded.has("further"), true);
  assert.deepEqual([...preferences.topicGroups], ["further"]);
  assert.deepEqual(repacks, [false, true]);
  assert.equal(bubble.getBoundingClientRect().top, 40);
  assert.deepEqual(scrollBehaviors, ["instant", "instant"]);
  click({ topic: "保研" });
  click({ selectGroup: "further" });
  settle();
  assert.deepEqual([...preferences.topicGroups], []);
  assert.deepEqual([...preferences.topics], ["保研"]);
  click({ selectGroup: "further" });
  listeners.get('[data-action="next"]')!();
  assert.deepEqual([...preferences.topicGroups], ["further"]);
  assert.equal(timers.size, 0);
  assert.equal(scrollBehaviors.at(-1), "smooth");
});
