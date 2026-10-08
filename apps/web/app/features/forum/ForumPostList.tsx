// 经验论坛的帖子卡片与列表。卡片只做摘要与计数，点击跳论坛详情页（生产场景都在论坛完成）。
import { useState } from "react";
import { IconFlame, IconHeart, IconMessage } from "../../components/icons";
import { monthDayTime } from "../../lib/format";
import type { ForumPostListItem } from "../../lib/forum.server";

export function ForumPostCard({ post, forumBase }: { post: ForumPostListItem; forumBase: string }) {
  const author = post.author?.display_name ?? post.author?.username ?? "匿名";
  return (
    <a href={`${forumBase}/posts/${post.id}`} className="block rounded-panel bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-line-strong">
      <div className="flex items-center gap-1.5 text-[12px] text-ink-4">
        {post.pinned_at && <span className="chip border-accent/50 bg-accent-soft text-accent">置顶</span>}
        <span className="truncate">{author}</span>
        <span aria-hidden>·</span>
        <span className="num shrink-0">{monthDayTime(post.created_at)}</span>
      </div>
      {post.title && <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{post.title}</h3>}
      <p className="mt-1 line-clamp-3 text-[13.5px] leading-relaxed text-ink-3">{post.content}</p>
      {post.images.length > 0 && (
        <div className="mt-2 flex gap-1.5 overflow-hidden">
          {post.images.slice(0, 3).map((img) => (
            <img key={img.id} src={img.asset_url} alt="" loading="lazy" className="size-16 rounded-control object-cover" />
          ))}
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-4">
        {post.tags.map((t) => (
          <span key={t.id} className="chip">
            {t.name}
          </span>
        ))}
        <span className="ml-auto inline-flex items-center gap-3">
          <span className="inline-flex items-center gap-1">
            <IconFlame size={12} />
            <span className="num">{post.views_count}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <IconHeart size={12} />
            <span className="num">{post.likes_count}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <IconMessage size={12} />
            <span className="num">{post.comments_count}</span>
          </span>
        </span>
      </div>
    </a>
  );
}

export function ForumPostList({ posts, forumBase }: { posts: ForumPostListItem[]; forumBase: string }) {
  return (
    <ul className="space-y-2.5">
      {posts.map((p) => (
        <li key={p.id}>
          <ForumPostCard post={p} forumBase={forumBase} />
        </li>
      ))}
    </ul>
  );
}

/** 「加载更多」：热榜 offset 分页，浏览器直连论坛公开读 API。 */
export function LoadMoreHot({ forumBase, initialOffset }: { forumBase: string; initialOffset: number | null }) {
  const [offset, setOffset] = useState(initialOffset);
  const [extra, setExtra] = useState<ForumPostListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  if (offset === null && extra.length === 0) return null;
  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch(`${forumBase}/api/posts?sort=hot&limit=20&offset=${offset}`, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(String(res.status));
      const page = (await res.json()) as { posts: ForumPostListItem[]; next_offset: number | null };
      setExtra((prev) => [...prev, ...page.posts]);
      setOffset(page.next_offset);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="mt-2.5">
      <ForumPostList posts={extra} forumBase={forumBase} />
      <div className="mt-4 text-center">
        {offset !== null ? (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-9 items-center rounded-full border border-line-strong bg-surface px-4 text-[13.5px] text-ink-2 transition-colors hover:border-ink-4 disabled:opacity-50"
          >
            {loading ? "加载中…" : failed ? "加载失败，重试" : "加载更多"}
          </button>
        ) : (
          extra.length > 0 && <span className="text-[12px] text-ink-4">到底了</span>
        )}
      </div>
    </div>
  );
}
