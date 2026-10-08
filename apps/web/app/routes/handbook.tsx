// 东大生存手册首页：板块总览（8 主题 + 子板块 + 文章数 + 近期文章预览），数据来自论坛 handbook API。
// 手册是编辑团队维护的沉淀内容（文章），与经验论坛的帖子分流；论坛高质量帖子由编辑整理后沉淀到这里。
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/handbook";
import {
  forumGet,
  ForumError,
  type HandbookArticleSummary,
  type HandbookSectionDetail,
  type HandbookSectionsResponse,
} from "../lib/forum.server";
import { pageMeta } from "../lib/seo";
import { EmptyState } from "../components/ui/Page";

const PREVIEW_COUNT = 4;

export async function loader({ request }: Route.LoaderArgs) {
  let data: HandbookSectionsResponse;
  try {
    data = await forumGet<HandbookSectionsResponse>("/api/handbook/sections", { signal: request.signal });
  } catch (error) {
    if (error instanceof ForumError) throw new Response("unavailable", { status: 503 });
    throw error;
  }
  // 每个板块带几篇近期文章标题吸引点入；单个板块预览失败不影响整页。
  const previews = await Promise.all(
    data.sections.map(async (s): Promise<HandbookArticleSummary[]> => {
      if (s.article_count === 0) return [];
      try {
        const detail = await forumGet<HandbookSectionDetail>(`/api/handbook/sections/${s.slug}`, { signal: request.signal });
        return detail.articles.slice(0, PREVIEW_COUNT);
      } catch {
        return [];
      }
    }),
  );
  return { sections: data.sections, previews };
}

export function meta() {
  return pageMeta({
    title: "东大生存手册",
    description: "滚动更新的东大生存手册：各板块由编辑团队撰写开篇与总览，具体经验由论坛高质量内容沉淀而来。",
    path: "/handbook",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

export default function Handbook() {
  const { sections, previews } = useLoaderData<typeof loader>();
  return (
    <div className="pb-6">
      <h1 className="pt-5 font-serif text-[24px] font-bold text-ink lg:pt-0 lg:text-[26px]">东大生存手册</h1>
      <p className="mt-2 max-w-[560px] text-[13.5px] leading-relaxed text-ink-3">
        滚动更新的共同手册：每个板块由编辑团队撰写开篇与总览，更具体的经验由论坛的高质量内容沉淀而来。
      </p>

      {sections.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="手册正在编写中">编辑团队正在撰写各板块的开篇，先到经验论坛看看大家的讨论。</EmptyState>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {sections.map((s, i) => {
            const preview = previews[i] ?? [];
            return (
              <section key={s.slug} className="card p-4 lg:flex lg:items-start lg:gap-6 lg:p-5" id={`handbook-${s.slug}`}>
                <div className="shrink-0 lg:w-[280px]">
                  <div className="flex items-baseline justify-between gap-3">
                    <Link to={`/handbook/${s.slug}`} className="text-[15px] font-semibold text-ink transition-colors hover:text-accent">
                      {s.name}
                    </Link>
                    <span className="num shrink-0 text-[12px] text-ink-4">{s.article_count} 篇</span>
                  </div>
                  {s.children.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {s.children.map((c) => (
                        <Link key={c.slug} to={`/handbook/${c.slug}`} className="chip hover:text-accent">
                          {c.name}
                          {c.article_count > 0 && <span className="num text-[11px] text-ink-4">{c.article_count}</span>}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
                {preview.length > 0 && (
                  <div className="mt-4 min-w-0 border-t border-line pt-3 lg:mt-0 lg:flex-1 lg:border-l lg:border-t-0 lg:pt-0 lg:pl-6">
                    <ul className="space-y-2">
                      {preview.map((a) => (
                        <li key={a.id} className="min-w-0">
                          <Link
                            to={`/handbook/article/${a.id}`}
                            className="group flex items-baseline gap-1.5 text-[13px] text-ink-2 transition-colors hover:text-accent"
                          >
                            <span aria-hidden className="shrink-0 text-ink-4 transition-colors group-hover:text-accent">›</span>
                            <span className="truncate">{a.title}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {s.article_count > preview.length && (
                      <Link
                        to={`/handbook/${s.slug}`}
                        className="mt-2.5 inline-block text-[12px] text-ink-4 transition-colors hover:text-accent"
                      >
                        全部 {s.article_count} 篇 →
                      </Link>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
