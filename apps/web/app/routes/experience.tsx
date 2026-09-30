// 经验分享：场景/年级/学院三维筛选（组内多选 OR、跨组 AND）+ 案例卡片。
import { Link, useLoaderData, useSearchParams } from "react-router";
import type { Route } from "./+types/experience";
import type { ExperienceIndex } from "@aihot/contracts/site";
import { apiGet, queryString } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const params = {
    category: url.searchParams.get("category"),
    grade: url.searchParams.get("grade"),
    college: url.searchParams.get("college"),
  };
  return apiGet<ExperienceIndex>(`/api/site/docs/experience${queryString(params)}`, { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "经验分享",
    description: "学长学姐围绕某段经历的完整叙述：转专业、海外交流、选调、校友访谈。个人经历标明作者与年份，不作为现行规则。",
    path: "/experience",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function ExperiencePage() {
  const data = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const selected = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
  const href = (key: string, v: string) => {
    const sp = new URLSearchParams(params);
    const next = toggle(selected(key), v);
    if (next.length) sp.set(key, next.join(","));
    else sp.delete(key);
    const s = sp.toString();
    return s ? `/experience?${s}` : "/experience";
  };
  return (
    <div className="pb-6">
      <h1 className="pt-5 font-serif text-[24px] font-bold text-ink lg:pt-0 lg:text-[26px]">经验分享</h1>
      <p className="mt-2 max-w-[560px] text-[13.5px] leading-relaxed text-ink-3">
        学长学姐的完整个人经历：做了什么、为什么这样选、踩过哪些坑。标明作者与发生年份，不作为现行规则。
      </p>

      <div className="mt-5 space-y-2.5">
        {data.filters.map((f) => (
          <div key={f.key} className="flex items-start gap-2">
            <span className="mt-1 w-8 shrink-0 text-[12px] text-ink-4">{f.label}</span>
            <div className="flex min-w-0 flex-wrap gap-1.5">
              {f.values.map((v) => {
                const active = selected(f.key).includes(v);
                return (
                  <Link key={v} to={href(f.key, v)} className={active ? "chip border-accent/50 bg-accent-soft text-accent" : "chip hover:text-accent"}>
                    {v}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <ul className="mt-6 space-y-2.5">
        {data.items.length === 0 && <li className="rounded-panel bg-surface px-4 py-10 text-center text-[13px] text-ink-4 ring-1 ring-line">这个筛选组合下暂时没有内容。</li>}
        {data.items.map((it) => (
          <li key={it.slug}>
            <Link to={`/${it.slug}`} className="block rounded-panel bg-surface p-4 ring-1 ring-line transition-shadow hover:ring-line-strong">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[14.5px] font-medium text-ink">{it.title}</span>
                {it.category && <span className="chip">{it.category}</span>}
              </div>
              {it.description && <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-3">{it.description}</p>}
              <div className="mt-2 text-[12px] text-ink-4">{[it.occurredAt, it.grade, it.college].filter(Boolean).join(" · ")}</div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
