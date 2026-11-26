// Unified top bar shared across 精选, 订阅, 分类 and 全部 so switching tabs stays silky with zero jump.
import type { SourceOption } from "@aihot/contracts/site";
import { Wordmark } from "../../components/Logo";
import { beijingDate, beijingWeekday } from "../../lib/format";
import { CategoryTabs, SelectedSourceChips, UnifiedSearchFilter } from "./Filters";

function TodayLabel() {
  const today = beijingDate(Date.now());
  const [, m, d] = today.split("-").map(Number) as [number, number, number];
  return (
    <span className="text-[12.5px] text-ink-4" suppressHydrationWarning>
      {m}月{d}日 · {beijingWeekday(today).replace("星期", "周")}
    </span>
  );
}

export function FeedTopBar({
  active,
  title,
  sourceOptions,
  selectedSources = [],
  searchDefaultValue = "",
  searchKeep = {},
  searchAutoFocus = false,
  sourceTargetPath,
}: {
  active: string;
  title: string;
  sourceOptions: SourceOption[];
  selectedSources?: string[];
  searchDefaultValue?: string;
  searchKeep?: Record<string, string | null>;
  searchAutoFocus?: boolean;
  /** Kept for compatibility with /all search routes; the unified search box is always visible. */
  showMobileSearchBar?: boolean;
  /** Redirect target when picking a source on a route that doesn't filter by sources itself (e.g. /subscription). */
  sourceTargetPath?: string;
}) {
  return (
    <header className="mb-4">
      <h1 className="sr-only">{title}</h1>

      {/* Phones: clean brand bar, single category strip, and unified search+source box below. */}
      <div className="lg:hidden">
        <div className="flex h-13 items-center justify-between">
          <Wordmark size={20} className="text-ink" />
          <TodayLabel />
        </div>
        <CategoryTabs active={active} layoutId="feed-top-tabs-mobile" size="sm" className="mt-1" />
        <div className="mt-2.5">
          <UnifiedSearchFilter
            options={sourceOptions}
            selected={selectedSources}
            defaultValue={searchDefaultValue}
            keep={searchKeep}
            autoFocus={searchAutoFocus}
            targetPath={sourceTargetPath}
          />
        </div>
        {selectedSources.length > 0 && (
          <div className="mt-2">
            <SelectedSourceChips options={sourceOptions} selected={selectedSources} />
          </div>
        )}
      </div>

      {/* Desktop: one crisp top row — category tabs on the left, merged search+source command box on the right. */}
      <div className="hidden lg:block">
        <div className="flex items-center justify-between gap-3">
          <CategoryTabs active={active} layoutId="feed-top-tabs" size="sm" className="min-w-0 flex-1" />
          <UnifiedSearchFilter
            options={sourceOptions}
            selected={selectedSources}
            defaultValue={searchDefaultValue}
            keep={searchKeep}
            autoFocus={searchAutoFocus}
            targetPath={sourceTargetPath}
            className="w-60 shrink-0 xl:w-72"
          />
        </div>
        {selectedSources.length > 0 && (
          <div className="mt-2.5">
            <SelectedSourceChips options={sourceOptions} selected={selectedSources} />
          </div>
        )}
      </div>
    </header>
  );
}
