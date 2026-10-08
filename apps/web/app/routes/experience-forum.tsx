// 经验论坛：热门（热榜，置顶优先，全员一致）+ 关注（登录后，关注板块/博主的帖子流）。
// 数据来自 seu-forum（forum.seu.wiki）：热门 SSR 拉取；关注带身份，由浏览器直连论坛。
import { useEffect, useState } from "react";
import { data as withHeaders, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/experience-forum";
import { FORUM_BASE, forumGet, ForumError, type ForumFollowingPage, type ForumHotPage, type ForumPostListItem } from "../lib/forum.server";
import { pageMeta } from "../lib/seo";
import { PillTabs } from "../components/ui/Tabs";
import { ForumPostList, LoadMoreHot } from "../features/forum/ForumPostList";
import { EmptyState } from "../components/ui/Page";

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const hot = await forumGet<ForumHotPage>("/api/posts?sort=hot&limit=20", { signal: request.signal });
    return withHeaders({ hot, forumBase: FORUM_BASE }, { headers: { "Cache-Control": "public, max-age=0, s-maxage=30" } });
  } catch (error) {
    if (error instanceof ForumError) throw withHeaders({ message: "unavailable" }, { status: 503 });
    throw error;
  }
}

export function meta() {
  return pageMeta({
    title: "经验论坛",
    description: "东大人的经验社区：保研、考研、留学、竞赛、实习与校园生活的帖子。热门按浏览与互动加权，置顶优先。",
    path: "/experience-forum",
  });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

/** 关注流：浏览器直连论坛（同站 cookie + 论坛 CORS 白名单），未登录/未开通过论坛给引导。 */
function FollowingFeed({ forumBase }: { forumBase: string }) {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "unauthorized" } | { kind: "error" } | { kind: "ok"; posts: ForumPostListItem[]; suggested: ForumFollowingPage["suggested_tags"] }>({ kind: "loading" });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${forumBase}/api/feed/following?limit=20`, { credentials: "include", headers: { accept: "application/json" } });
        if (cancelled) return;
        if (res.status === 401) return setState({ kind: "unauthorized" });
        if (!res.ok) return setState({ kind: "error" });
        const page = (await res.json()) as ForumFollowingPage;
        setState({ kind: "ok", posts: page.posts, suggested: page.suggested_tags });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [forumBase]);

  if (state.kind === "loading") return <p className="py-16 text-center text-[13px] text-ink-4">加载中…</p>;
  if (state.kind === "unauthorized") {
    return (
      <EmptyState
        title="登录后查看关注流"
        action={
          <a href={forumBase} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-contrast hover:bg-accent-ink">
            去论坛登录
          </a>
        }
      >
        关注流来自你在论坛关注的板块和博主。用统一账户在论坛登录一次，这里就能直接看。
      </EmptyState>
    );
  }
  if (state.kind === "error") {
    return <EmptyState title="关注流暂时不可用">稍后再试，或直接去论坛查看。</EmptyState>;
  }
  if (state.posts.length === 0) {
    return (
      <EmptyState title="还没有关注任何板块或博主">
        {state.suggested && state.suggested.length > 0 ? (
          <span className="mt-1 flex flex-wrap justify-center gap-1.5">
            {state.suggested.map((t) => (
              <a key={t.slug} href={`${forumBase}/tags/${t.slug}`} className="chip hover:text-accent">
                {t.name}（{t.post_count}）
              </a>
            ))}
          </span>
        ) : (
          "去论坛逛逛，关注几个感兴趣的板块吧。"
        )}
      </EmptyState>
    );
  }
  return <ForumPostList posts={state.posts} forumBase={forumBase} />;
}

export default function ExperienceForum() {
  const { hot, forumBase } = useLoaderData<typeof loader>();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "following" ? "following" : "hot";
  const setTab = (key: string) => setParams(key === "following" ? { tab: "following" } : {}, { preventScrollReset: true });

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between gap-4 pt-5 lg:pt-0">
        <h1 className="font-serif text-[24px] font-bold text-ink lg:text-[26px]">经验论坛</h1>
        <a
          href={`${forumBase}/submit-post`}
          className="inline-flex h-9 shrink-0 items-center rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-contrast transition-colors hover:bg-accent-ink"
        >
          发帖
        </a>
      </div>
      <p className="mt-2 max-w-[560px] text-[13.5px] leading-relaxed text-ink-3">
        东大人的经验社区。热门按新鲜度与互动加权、置顶优先，对所有人一致；关注是你订阅的板块与博主。
      </p>

      <div className="mt-4">
        <PillTabs
          layoutId="experience-forum-tabs"
          label="经验论坛"
          active={tab}
          onSelect={setTab}
          items={[
            { key: "hot", label: "热门" },
            { key: "following", label: "关注" },
          ]}
        />
      </div>

      <div className="mt-4">
        {tab === "hot" ? (
          hot.posts.length === 0 ? (
            <EmptyState
              title="还没有帖子"
              action={
                <a href={`${forumBase}/submit-post`} className="inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13.5px] font-medium text-accent-contrast hover:bg-accent-ink">
                  发第一帖
                </a>
              }
            >
              论坛刚开张，来分享你的经验吧。
            </EmptyState>
          ) : (
            <>
              <ForumPostList posts={hot.posts} forumBase={forumBase} />
              <LoadMoreHot forumBase={forumBase} initialOffset={hot.next_offset} />
            </>
          )
        ) : (
          <FollowingFeed forumBase={forumBase} />
        )}
      </div>
    </div>
  );
}
