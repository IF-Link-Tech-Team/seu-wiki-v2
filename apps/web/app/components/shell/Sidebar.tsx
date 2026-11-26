import { SITE } from "@aihot/industry/site";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { Wordmark } from "../Logo";
import { SidebarPaperArt } from "../PaperArt";
import { useChangelogSeen } from "../../lib/local-state";
import { SIDEBAR, tabIsActive, type NavItem } from "./nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { AccountEntry } from "../../features/member/AccountEntry";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}

function SideLink({ item, dot }: { item: NavItem; dot: boolean }) {
  const { pathname } = useLocation();
  const isActive = tabIsActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      prefetch="intent"
      aria-current={isActive ? "page" : undefined}
      className={`flex h-9 items-center gap-2.5 rounded-tile px-3 text-[13.5px] transition-all duration-150 ${
        isActive
          ? "glass-on-forest font-bold text-[var(--forest-glass-ink)]"
          : "font-medium text-[var(--forest-muted)] hover:bg-[var(--forest-dock-bg)] hover:text-[var(--forest-ink)]"
      }`}
    >
      <span className={`flex w-[20px] shrink-0 justify-center ${isActive ? "text-accent" : ""}`}>
        <Icon size={16} />
      </span>
      <span className="min-w-0 truncate">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
    </Link>
  );
}

export function Sidebar({ changelogVersion, memberAuth = false }: { changelogVersion: string | null; memberAuth?: boolean }) {
  const dot = useChangelogDot(changelogVersion);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[192px] shrink-0 flex-col overflow-hidden border-r border-[var(--forest-border)] bg-[linear-gradient(180deg,var(--forest)_0%,var(--forest-deep)_100%)] text-[var(--forest-ink)] lg:flex">
      <div className="flex min-h-0 flex-1 flex-col px-3 pt-5">
        <Link to="/" className="mb-3 flex h-[44px] items-center px-1.5" aria-label={`${SITE.name} 首页`}>
          <Wordmark size={22} onForest />
        </Link>
        <nav className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 scrollbar-none" aria-label="主导航">
          {SIDEBAR.map((section) => (
            <div key={section.title}>
              <div className="px-3 pb-1 pt-3 text-[11px] font-semibold tracking-[0.08em] text-[var(--forest-muted)] opacity-70">{section.title}</div>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <SideLink key={item.to} item={item} dot={dot} />
                ))}
              </div>
            </div>
          ))}
        </nav>
      </div>

      {/* Cut-paper campus diorama sits cleanly in its own flow band above the compact footer dock — zero overlap */}
      <div className="shrink-0 overflow-hidden pt-2">
        <SidebarPaperArt className="block h-[116px] w-full" />
      </div>

      <div className="shrink-0 border-t border-[var(--forest-border)] bg-[var(--forest-dock-bg)] px-2.5 pb-2.5 pt-2 backdrop-blur-md">
        <div className="space-y-1.5">
          <AccountEntry enabled={memberAuth} onForest compact />
          <ThemeSwitch onForest compact />
        </div>
        {SITE.icp && (
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="mt-1.5 block px-1.5 text-[9.5px] leading-tight text-[var(--forest-muted)] opacity-70 hover:opacity-100">
            {SITE.icp}
          </a>
        )}
      </div>
    </aside>
  );
}
