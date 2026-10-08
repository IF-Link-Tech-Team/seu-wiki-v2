// 手册板块页：板块信息 + 文章列表（published_at 倒序）。主题板块顺带展示子板块入口。
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/handbook.$slug";
import { forumGet, ForumError, type HandbookSectionDetail, type HandbookSectionsResponse } from "../lib/forum.server";
import { pageMeta } from "../lib/seo";
import { EmptyState } from "../components/ui/Page";
import { beijingDate } from "../lib/format";

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  try {
    // tag 型板块接口只回 slug；板块名从总览里查（一次额外请求，响应带缓存）。
    const [detail, overview] = await Promise.all([
      forumGet<HandbookSectionDetail>(`/api/handbook/sections/${encodeURIComponent(slug)}`, { signal: request.signal }),
      forumGet<HandbookSectionsResponse>("/api/handbook/sections", { signal: request.signal }),
    ]);
    const name =
      detail.section.type === "topic"
        ? detail.section.name
        : (overview.sections.flatMap((s) => [s, ...s.children]).find((s) => s.slug === detail.section.slug)?.name ?? detail.section.slug);
    return { detail, name };
  } catch (error) {
    if (error instanceof ForumError && error.status === 404) throw new Response("not_found", { status: 404 });
    if (error instanceof ForumError) throw new Response("unavailable", { status: 503 });
    throw error;
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData?.name;
  return pageMeta({ title: name ? `${name} · 东大生存手册` : "东大生存手册", path: `/handbook/${loaderData?.detail.section.slug ?? ""}` });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

export default function HandbookSectionPage() {
  const { detail, name } = useLoaderData<typeof loader>();
  const { section, articles } = detail;
  return (
    <div className="pb-6">
      <Link to="/handbook" className="mb-3 mt-5 inline-block text-[12.5px] text-ink-4 hover:text-accent lg:mt-0">
        ← 东大生存手册
      </Link>
      <h1 className="font-serif text-[24px] font-bold text-ink lg:text-[26px]">{name}</h1>

      {section.type === "topic" && section.children.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {section.children.map((c) => (
            <Link key={c.slug} to={`/handbook/${c.slug}`} className="chip hover:text-accent">
              {c.name}
            </Link>
          ))}
        </div>
      )}

      {articles.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="这个板块还没有文章">板块开篇由编辑团队撰写中；相关的讨论可以先进经验论坛。</EmptyState>
        </div>
      ) : (
        <ul className="mt-5 space-y-2.5">
          {articles.map((a) => (
            <li key={a.id}>
              <Link to={`/handbook/article/${a.id}`} className="block rounded-panel bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-line-strong">
                <span className="text-[14.5px] font-medium text-ink">{a.title}</span>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 text-[12px] text-ink-4">
                  {a.author_display && <span>{a.author_display}</span>}
                  <span className="num">{beijingDate(a.published_at)}</span>
                  {a.source_post && <span>· 沉淀自论坛帖子</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
