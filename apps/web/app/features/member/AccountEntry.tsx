// 登录/用户入口：未配置统一账户时显示不可用提示。状态请求禁缓存、同源带 cookie，
// pageshow/窗口聚焦时刷新（跨站 SSO 回来后不能还显示旧的匿名状态）。
// 接口 5xx 时保留入口并提示"暂时不可用"，不隐藏、不冒充未登录。
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router";
import { IconUsers } from "../../components/icons";
import { memberReturnPath } from "./member-return";

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

export function AccountEntry({ enabled, onForest = false, compact = false }: { enabled: boolean; onForest?: boolean; compact?: boolean }) {
  const state = useMemberState(enabled);
  const location = useLocation();
  const returnTo = memberReturnPath(location.pathname, location.search);
  const iconSize = compact ? 14 : 17;
  const iconBox = compact ? "flex w-[16px] shrink-0 justify-center" : "flex w-[22px] shrink-0 justify-center";
  const base = compact
    ? "flex h-7 items-center gap-1.5 rounded-control px-2 text-[12px] font-medium transition-colors"
    : "flex h-10 items-center gap-2.5 rounded-tile px-2.5 text-[13.5px] font-medium transition-colors";
  if (!enabled) return <div className={`${base} ${onForest ? "text-[var(--forest-muted)] opacity-80" : "text-ink-4"}`} title="本地尚未配置 IF.Link 统一账户"><span className={iconBox}><IconUsers size={iconSize} /></span><span className="truncate">登录暂未启用</span></div>;
  if (state.kind === "loading") return null;
  if (state.kind === "unavailable") {
    return (
      <div className={`${base} ${onForest ? "text-[var(--forest-muted)]" : "text-ink-4"}`}>
        <span className={iconBox}><IconUsers size={iconSize} /></span>
        <span className="truncate">账号暂时不可用</span>
      </div>
    );
  }
  if (state.kind === "member") {
    return (
      <div className={`${base} ${onForest ? "text-[var(--forest-ink)]" : "text-ink-3"}`}>
        <span className={`${iconBox} text-accent`}><IconUsers size={iconSize} /></span>
        <span className="min-w-0 flex-1 truncate">{state.name}</span>
        <form method="post" action="/api/logto/sign-out">
          <button type="submit" className={`text-[11px] ${onForest ? "text-[var(--forest-muted)] hover:text-[var(--forest-ink)]" : "text-ink-4 hover:text-ink-2"}`}>退出</button>
        </form>
      </div>
    );
  }
  return (
    <a href={`/api/logto/sign-in?redirect=${encodeURIComponent(returnTo)}`} className={`${base} ${onForest ? "text-[var(--forest-ink)] hover:bg-[var(--forest-glass-bg)]" : "text-ink-3 hover:bg-bg-sunk hover:text-ink"}`}>
      <span className={iconBox}><IconUsers size={iconSize} /></span>
      <span className="truncate">登录 IF.Link 账号</span>
    </a>
  );
}
