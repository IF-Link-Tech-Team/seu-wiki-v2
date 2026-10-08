// 手册文章页：正文是论坛服务端渲染并消毒过的 HTML（content_html），直接注入 prose。
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/handbook.article.$id";
import { FORUM_BASE, forumGet, ForumError, type HandbookArticleDetail } from "../lib/forum.server";
import { pageMeta } from "../lib/seo";
import { beijingDate } from "../lib/format";

export async function loader({ params, request }: Route.LoaderArgs) {
  const id = params.id ?? "";
  try {
    const { article } = await forumGet<{ article: HandbookArticleDetail }>(`/api/handbook/articles/${encodeURIComponent(id)}`, { signal: request.signal });
    return { article, forumBase: FORUM_BASE };
  } catch (error) {
    if (error instanceof ForumError && error.status === 404) throw new Response("not_found", { status: 404 });
    if (error instanceof ForumError) throw new Response("unavailable", { status: 503 });
    throw error;
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const a = loaderData?.article;
  return pageMeta({ title: a ? `${a.title} · 东大生存手册` : "东大生存手册", path: `/handbook/article/${a?.id ?? ""}`, type: "article" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

function MetaLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[12.5px] leading-relaxed">
      <span className="shrink-0 text-ink-4">{label}</span>
      <span className="min-w-0 text-ink-3">{children}</span>
    </div>
  );
}

export default function HandbookArticlePage() {
  const { article, forumBase } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <Link to={`/handbook/${article.tag_slug}`} className="mb-3 mt-5 inline-block text-[12.5px] text-ink-4 hover:text-accent lg:mt-0">
        ← 返回板块
      </Link>
      <article>
        <h1 className="font-serif text-[26px] font-bold leading-snug tracking-tight text-ink lg:text-[30px]">{article.title}</h1>
        <div className="mt-3 space-y-1 rounded-panel bg-bg-sunk px-4 py-3">
          {article.author_display && <MetaLine label="作者">{article.author_display}</MetaLine>}
          <MetaLine label="发布">
            <span className="num">{beijingDate(article.published_at)}</span>
          </MetaLine>
          {article.updated_at !== article.published_at && (
            <MetaLine label="更新">
              <span className="num">{beijingDate(article.updated_at)}</span>
            </MetaLine>
          )}
          {article.source_post && (
            <MetaLine label="来源">
              <a href={`${forumBase}/posts/${article.source_post.id}`} className="text-accent hover:underline">
                沉淀自论坛帖子{article.source_post.title ? `《${article.source_post.title}》` : ""}
              </a>
            </MetaLine>
          )}
        </div>
        {/* eslint-disable-next-line react/no-danger -- 论坛服务端已渲染并消毒 */}
        <div className="prose mt-6" dangerouslySetInnerHTML={{ __html: article.content_html }} />
      </article>
    </div>
  );
}
