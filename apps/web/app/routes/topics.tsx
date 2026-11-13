import { Link, useLoaderData } from "react-router";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

interface TopicSummary {
  slug: string;
  name: string;
  group: "org" | "college" | "topic";
  definition: string;
  total: number;
  recent: number;
  indexable: boolean;
  latestAt: string | null;
}

export async function loader({ request }: { request: Request }) {
  return apiGet<{ topics: TopicSummary[] }>("/api/site/topics", { signal: request.signal });
}

export function meta() {
  return pageMeta({ title: "主题", description: "按部门机构、学院、主题聚合的校园信息页：教务处、学生处、各学院、保研、竞赛、实习就业等方向。", path: "/topics", image: "/og/pages/topics.png" });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}

const GROUPS = [
  { key: "org", name: "部门与机构", blurb: "按发布单位追踪：教务处、学生处、团委……" },
  { key: "college", name: "学院", blurb: "按学院聚合本院的通知、活动与机会" },
  { key: "topic", name: "主题", blurb: "按你关心的事浏览：保研、竞赛、实习、志愿服务……" },
] as const;

export default function TopicsPage() {
  const { topics } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <header className="pb-2 pt-5 lg:pt-1">
        <h1 className="browse-title">按主题看校园</h1>
        <p className="mt-2 text-sm leading-normal text-ink-3">
          按部门机构、学院、主题浏览 <span className="num">{topics.length}</span> 个主题，持续汇集近期通知与机会。
        </p>
      </header>
      {GROUPS.map((g) => (
        <section key={g.key} aria-labelledby={`topics-${g.key}`} className="pt-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id={`topics-${g.key}`} className="text-[15px] font-semibold leading-normal text-ink">
              {g.name}
            </h2>
            <p className="text-[13px] leading-normal text-ink-4">{g.blurb}</p>
          </div>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {topics
              .filter((t) => t.group === g.key)
              .map((t) => (
                <li key={t.slug}>
                  <Link
                    to={`/topics/${t.slug}`}
                    prefetch="intent"
                    aria-label={`查看${t.name}相关精选文章`}
                    className="card card-hover group flex h-full flex-col gap-2 bg-panel-quiet p-4"
                  >
                    <span className="text-[15px] font-semibold leading-normal wrap-anywhere text-ink transition-colors group-hover:text-accent">{t.name}</span>
                    <span className="flex-1 text-sm leading-normal wrap-anywhere text-ink-3">{t.definition}</span>
                    <span className="text-[13px] text-ink-4 group-hover:text-accent">
                      查看 {t.total} 条精选 <span className="inline-block transition-transform duration-200 group-hover:translate-x-0.5">→</span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
