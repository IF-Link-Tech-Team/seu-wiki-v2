// seu.wiki 内嵌论坛（seu-forum / forum.seu.wiki）数据的读取层。
// 公开读（热榜、手册）由 SSR 经服务端拉取；关注流带用户身份，由浏览器直连论坛（凭同源站
// cookie + 论坛侧 CORS 白名单）。发帖/评论等生产场景一律跳论坛完成。

/** 论坛站点根地址（也用于外链：帖子详情、发帖页、登录引导）。 */
export const FORUM_BASE = (process.env.FORUM_API_BASE || "https://forum.seu.wiki").replace(/\/+$/, "");

export class ForumError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** 服务端拉论坛公开读 API；非 2xx 抛 ForumError（404 由调用方转成页面 404，其余 503）。 */
export async function forumGet<T>(path: string, init?: { signal?: AbortSignal }): Promise<T> {
  const res = await fetch(`${FORUM_BASE}${path}`, {
    headers: { accept: "application/json" },
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new ForumError(res.status, `forum ${res.status} ${path}`);
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// 论坛公开读 API 的响应形状（与 seu-forum src/lib/services 的接口对应）
// ---------------------------------------------------------------------------

export interface ForumUserCard {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface ForumTag {
  id: string;
  name: string;
  slug: string;
}

export interface ForumPostImage {
  id: string;
  asset_url: string;
  mime_type: string | null;
}

export interface ForumPostListItem {
  id: string;
  title: string | null;
  content: string;
  post_type: string;
  created_at: string;
  likes_count: number;
  comments_count: number;
  views_count: number;
  pinned_at: string | null;
  author: ForumUserCard | null;
  images: ForumPostImage[];
  tags: ForumTag[];
}

/** GET /api/posts?sort=hot（offset 分页）。 */
export interface ForumHotPage {
  posts: ForumPostListItem[];
  total_count: number;
  next_offset: number | null;
}

export interface ForumSuggestedTopic {
  slug: string;
  name: string;
  post_count: number;
}

/** GET /api/feed/following（keyset 分页；零关注时带 suggested_tags）。 */
export interface ForumFollowingPage {
  posts: ForumPostListItem[];
  next_cursor: string | null;
  suggested_tags: ForumSuggestedTopic[] | null;
}

// ---------------------------------------------------------------------------
// 东大生存手册（handbook）
// ---------------------------------------------------------------------------

export interface HandbookSectionChild {
  slug: string;
  name: string;
  article_count: number;
}

export interface HandbookSection {
  slug: string;
  name: string;
  article_count: number;
  children: HandbookSectionChild[];
}

export interface HandbookSectionsResponse {
  sections: HandbookSection[];
}

export interface HandbookArticleSummary {
  id: string;
  tag_slug: string;
  title: string;
  author_display: string | null;
  published_at: string;
  source_post: { id: string; title: string | null } | null;
}

export interface HandbookSectionDetail {
  section:
    | { type: "topic"; slug: string; name: string; children: Array<{ slug: string; name: string }> }
    | { type: "tag"; slug: string; parent_slug: string | null };
  articles: HandbookArticleSummary[];
}

export interface HandbookArticleDetail {
  id: string;
  tag_slug: string;
  title: string;
  author_display: string | null;
  /** 论坛服务端已渲染并消毒的 HTML，可以直接注入。 */
  content_html: string;
  published_at: string;
  updated_at: string;
  source_post: ({ id: string; title: string | null } & { likes_count: number; comments_count: number; views_count: number; author: ForumUserCard | null }) | null;
}
