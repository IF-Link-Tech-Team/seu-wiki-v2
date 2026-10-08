// 首页：默认「精选」信息流（过门槛、全员一致）；分类/一手 tab 是不设门槛的全量列表（按时间倒序），
// 「全部」tab 在 /all。信源（学院/部门）筛选对两种模式都生效。
import { data as withHeaders, redirect, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/home";
import type { PoolResponse, SourceListResponse, TimelineResponse } from "@aihot/contracts/site";
import { CATEGORY_LABELS, isCategoryKey, isChannelKey, type CategoryKey } from "@aihot/contracts/taxonomy";
import { loadOr404, queryString, releaseBoundCache } from "../lib/api.server";
import { listPath, organizationLd, pageMeta } from "../lib/seo";
import { Wordmark } from "../components/Logo";
import { Timeline } from "../features/feed/Timeline";
import { HotTopics } from "../features/feed/HotTopics";
import { CategoryTabs, SearchField, SearchIconLink, SelectedSourceChips, SourceFilter } from "../features/feed/Filters";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState } from "../components/ui/Page";
import { beijingDate, beijingWeekday } from "../lib/format";

function parseSourcesParam(url: URL): string[] | null {
  const ids = (url.searchParams.get("sources") ?? "").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 20);
  return ids.length ? ids : null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  // Search lives on /all; keep the parameters so old links still land on results.
  if (q && q.trim()) throw redirect(`/all${url.search}`);
  const channelParam = url.searchParams.get("channel") ?? "all";
  const categoryParam = url.searchParams.get("category");
  const channel = isChannelKey(channelParam) ? channelParam : "all";
  const category = categoryParam && isCategoryKey(categoryParam) ? categoryParam : null;
  const tag = url.searchParams.get("tag")?.trim() || null;
  const sources = parseSourcesParam(url);
  // 分类/一手 tab：不设门槛的全量列表；其余（含 legacy 的 news/x 频道）走精选 timeline。
  const flat = category !== null || channel === "firstParty";
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 50);

  const sourcesParam = sources?.join(",") ?? null;
  if (flat) {
    const [pool, sourceOptions] = await Promise.all([
      loadOr404<PoolResponse>(`/api/site/pool${queryString({ channel: channel === "firstParty" ? "firstParty" : null, category, sources: sourcesParam, type: "feed", page: page > 1 ? page : null })}`, { signal: request.signal }),
      loadOr404<SourceListResponse>("/api/site/sources", { signal: request.signal }),
    ]);
    return withHeaders(
      { mode: "flat" as const, pool, timeline: null, filters: pool.filters, sources, sourceOptions: sourceOptions.sources },
      { headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=30" } },
    );
  }

  const upstream = new Headers();
  const [timeline, sourceOptions] = await Promise.all([
    loadOr404<TimelineResponse>(`/api/site/timeline${queryString({ channel: channel === "all" ? null : channel, category, tag, sources: sourcesParam })}`, { responseHeaders: upstream, signal: request.signal }),
    loadOr404<SourceListResponse>("/api/site/sources", { signal: request.signal }),
  ]);
  return withHeaders(
    { mode: "timeline" as const, timeline, pool: null, filters: timeline.filters, sources, sourceOptions: sourceOptions.sources },
    { headers: releaseBoundCache(timeline.refreshAt, 60, Date.now(), upstream) },
  );
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.filters;
  const path = listPath("/", { channel: f && f.channel !== "all" ? f.channel : null, category: f?.category, tag: f?.tag });
  return pageMeta({ path, jsonLd: path === "/" ? organizationLd() : undefined });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

function TodayLabel() {
  const today = beijingDate(Date.now());
  const [, m, d] = today.split("-").map(Number) as [number, number, number];
  return (
    <span className="text-[12.5px] text-ink-4" suppressHydrationWarning>
      {m}月{d}日 · {beijingWeekday(today).replace("星期", "周")}
    </span>
  );
}

export default function Home() {
  const { mode, timeline, pool, filters, sources, sourceOptions } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const selectedSources = sources ?? [];
  const active = filters.channel === "firstParty" ? "firstParty" : (filters.category ?? "selected");
  const title = filters.tag
    ? `#${filters.tag}`
    : filters.channel === "firstParty"
      ? "一手"
      : filters.category
        ? CATEGORY_LABELS[filters.category as CategoryKey]
        : "精选";
  const pageHref = (p: number) => {
    const sp = new URLSearchParams(params);
    if (p <= 1) sp.delete("page");
    else sp.set("page", String(p));
    const s = sp.toString();
    return s ? `/?${s}` : "/";
  };

  return (
    <div className="pb-6">
      {/* Phones: brand bar, today's hot topics, then the feed under its title. */}
      <div className="flex h-14 items-center justify-between lg:hidden">
        <Wordmark size={20} className="text-ink" />
        <TodayLabel />
      </div>
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title}</h1>
        <div className="mb-5 mt-4 flex items-center justify-between gap-4">
          <CategoryTabs active={active} layoutId="home-cat-desk" className="min-w-0" />
          <div className="flex shrink-0 items-center gap-2">
            <SourceFilter options={sourceOptions} selected={selectedSources} />
            <SearchField variant="track" keep={{ category: filters.category, sources: sources?.join(",") ?? null }} />
          </div>
        </div>
        <SelectedSourceChips options={sourceOptions} selected={selectedSources} />
      </div>

      {mode === "timeline" && timeline?.hot && <HotTopics entries={timeline.hot} />}

      <h2 className="mt-6 text-[20px] font-bold text-ink lg:hidden">{filters.tag ? title : mode === "timeline" ? "最新精选" : title}</h2>
      <div className="-mx-4 mt-3 flex items-center gap-2 pl-4 pr-2 lg:hidden">
        <CategoryTabs active={active} layoutId="home-cat-mobile" size="sm" className="min-w-0 flex-1" />
        <SearchIconLink />
      </div>
      <div className="mt-2 flex items-center justify-between lg:hidden">
        <SelectedSourceChips options={sourceOptions} selected={selectedSources} />
        <SourceFilter options={sourceOptions} selected={selectedSources} />
      </div>

      {mode === "timeline" && timeline ? (
        <Timeline initial={timeline} filters={timeline.filters} />
      ) : pool ? (
        <>
          {pool.items.length === 0 ? (
            <div className="mt-2 lg:card">
              <EmptyState title="没有找到相关内容">这个筛选下暂时没有内容。</EmptyState>
            </div>
          ) : (
            <DayList items={pool.items} todayCount={pool.todayCount} showTags />
          )}
          <Pagination page={pool.page} pageCount={pool.pageCount} href={pageHref} />
        </>
      ) : null}
    </div>
  );
}
