// 登录/用户入口：站点启用统一账户时才渲染。状态请求禁缓存、同源带 cookie，
// pageshow/窗口聚焦时刷新（跨站 SSO 回来后不能还显示旧的匿名状态）。
// 接口 5xx 时保留入口并提示"暂时不可用"，不隐藏、不冒充未登录。
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { IconUsers } from "../../components/icons";

type State =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "member"; name: string }
  | { kind: "unavailable" };

export function useMemberState(enabled: boolean): State {
  const [state, setState] = useState<State>({ kind: "loading" });
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/member/me", { cache: "no-store", credentials: "same-origin" });
      if (res.status === 401) return setState({ kind: "anonymous" });
      if (!res.ok) return setState({ kind: "unavailable" });
      const data = (await res.json()) as { member: { name: string | null; email: string | null } };
      setState({ kind: "member", name: data.member.name ?? data.member.email ?? "已登录" });
    } catch {
      setState({ kind: "unavailable" });
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void load();
    const onShow = () => void load();
    window.addEventListener("pageshow", onShow);
    window.addEventListener("focus", onShow);
    return () => {
      window.removeEventListener("pageshow", onShow);
      window.removeEventListener("focus", onShow);
    };
  }, [enabled, load]);
  return enabled ? state : { kind: "loading" };
}

export function AccountEntry({ enabled }: { enabled: boolean }) {
  const state = useMemberState(enabled);
  const { pathname, search } = useLocation();
  if (!enabled) return null;
  const base = "flex h-10 items-center gap-2.5 rounded-control px-2.5 text-[14px] font-medium transition-colors";
  if (state.kind === "loading") return null;
  if (state.kind === "unavailable") {
    return (
      <div className={`${base} text-ink-4`}>
        <span className="flex w-[22px] shrink-0 justify-center"><IconUsers size={17} /></span>
        账号暂时不可用
      </div>
    );
  }
  if (state.kind === "member") {
    return (
      <div className={`${base} text-ink-3`}>
        <span className="flex w-[22px] shrink-0 justify-center text-accent"><IconUsers size={17} /></span>
        <span className="min-w-0 flex-1 truncate">{state.name}</span>
        <form method="post" action="/api/logto/sign-out">
          <button type="submit" className="text-[12px] text-ink-4 hover:text-ink-2">退出</button>
        </form>
      </div>
    );
  }
  return (
    <a href={`/api/logto/sign-in?redirect=${encodeURIComponent(`${pathname}${search}`)}`} className={`${base} text-ink-3 hover:bg-bg-sunk hover:text-ink`}>
      <span className="flex w-[22px] shrink-0 justify-center"><IconUsers size={17} /></span>
      登录 IF.Link 账号
    </a>
  );
}
