import { Link, useLocation } from "react-router";
import { TABBAR, tabIsActive } from "./nav";
import { useChangelogDot } from "./Sidebar";

/** Bottom tab bar of the mobile shell (up to 960px), as on the original site. */
export function MobileTabBar({ changelogVersion }: { changelogVersion: string | null }) {
  const { pathname } = useLocation();
  const dot = useChangelogDot(changelogVersion);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(10px+env(safe-area-inset-bottom))] lg:hidden">
      <nav aria-label="底部导航" className="glass-dock pointer-events-auto mx-auto grid h-[58px] max-w-[440px] grid-cols-4 rounded-full px-1.5">
        {TABBAR.map((t) => {
          const active = tabIsActive(t, pathname);
          const Icon = t.icon;
          return (
            <Link
              key={t.to}
              to={t.to}
              prefetch="intent"
              aria-current={active ? "page" : undefined}
              className={`relative my-1.5 flex flex-col items-center justify-center gap-[2px] rounded-full text-[11px] transition-all duration-150 ${
                active ? "bg-[var(--nav-active-bg)] font-bold text-[var(--nav-active-ink)] shadow-[var(--shadow-thumb)] ring-1 ring-inset ring-[var(--nav-active-border)]" : "text-ink-3 active:text-ink"
              }`}
            >
              <Icon size={19} />
              <span>{t.label}</span>
              {dot && t.changelog && <span className="absolute right-[calc(50%-18px)] top-1.5 size-1.5 rounded-full bg-hot" aria-label="有新的更新" />}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
