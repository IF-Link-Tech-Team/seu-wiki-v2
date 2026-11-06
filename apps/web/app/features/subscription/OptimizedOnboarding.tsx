import { useCallback, useEffect, useRef, useState } from "react";
import type { SubscriptionProfile } from "@aihot/contracts/subscription";
import { fromOptimizedProfile, legacyTopicExtras, toOptimizedProfile } from "@aihot/contracts/subscription-onboarding";
import html from "./optimized-profile.html?raw";

const CHANNEL = "seu-optimized-onboarding-v1";

/** Retains the supplied HTML's layout and physics in a script-only sandbox. */
export function OptimizedOnboarding({ initialProfile, onComplete, onCancel }: {
  initialProfile?: SubscriptionProfile | null;
  onComplete: (profile: SubscriptionProfile) => Promise<void>;
  onCancel?: () => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const token = useRef("");
  const completed = useRef(false);
  const callbacks = useRef({ initialProfile, onComplete });
  callbacks.current = { initialProfile, onComplete };
  const [ready, setReady] = useState(false);
  const initialize = useCallback(() => {
    if (!token.current) token.current = crypto.randomUUID();
    const profile = toOptimizedProfile(callbacks.current.initialProfile);
    frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type: "init", token: token.current, profile, extraTopics: legacyTopicExtras(profile) }, "*");
  }, []);
  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.origin !== "null" || event.data?.channel !== CHANNEL) return;
      if (event.data.type === "ready") { setReady(true); initialize(); return; }
      if (event.data.type !== "complete" || !token.current || event.data.token !== token.current || completed.current) return;
      completed.current = true;
      void (async () => { try {
        const profile = fromOptimizedProfile(event.data.profile, callbacks.current.initialProfile);
        await callbacks.current.onComplete(profile);
        frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type: "saved", token: token.current }, "*");
      } catch (error) {
        completed.current = false;
        frame.current?.contentWindow?.postMessage({ channel: CHANNEL, type: "error", token: token.current, message: error instanceof Error ? error.message : "设置未能保存，请重试。" }, "*");
      } })();
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [initialize]);
  return <section aria-label="首次使用设置" className="my-5">
    {onCancel && <div className="mb-3 text-right"><button type="button" className="rounded-xl border border-line px-4 py-2 text-sm" onClick={onCancel}>取消修改，返回订阅流</button></div>}
    {!ready && <p role="status" className="mb-3 text-sm text-ink-3">正在准备用户画像调查…</p>}
    <iframe ref={frame} title="用户画像与订阅设置 · 优化版" srcDoc={html} sandbox="allow-scripts" onLoad={() => { setReady(true); initialize(); }}
      className="block w-full rounded-2xl border-0" style={{ height: "max(620px, calc(100dvh - 190px))", maxHeight: 1100 }} />
  </section>;
}
