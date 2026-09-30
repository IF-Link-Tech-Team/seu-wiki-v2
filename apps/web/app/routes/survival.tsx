// 手册目录首页：篇 → 组 → 条目的目录树，顺序沿用《SEU 生存指南 2.0》原目录（导入时按 survival.ts 计算）。
import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/survival";
import type { SurvivalPartView } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

export async function loader({ request }: Route.LoaderArgs) {
  return apiGet<{ parts: SurvivalPartView[] }>("/api/site/docs/survival", { signal: request.signal });
}

export function meta() {
  return pageMeta({
    title: "生存手册",
    description: "东南大学学生关于成长、学习、生活与选择的共同手册：观点、方向、学习、生活与校友篇，连续阅读。",
    path: "/survival",
  });
}

export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=60" };
}

export default function SurvivalIndex() {
  const { parts } = useLoaderData<typeof loader>();
  return (
    <div className="pb-6">
      <h1 className="pt-5 font-serif text-[24px] font-bold text-ink lg:pt-0 lg:text-[26px]">生存手册</h1>
      <p className="mt-2 max-w-[560px] text-[13.5px] leading-relaxed text-ink-3">
        东大学生关于成长、学习、生活与选择的共同手册。长期内容以 Git 为编辑真源，时效注记保留在正文原处。
      </p>
      <div className="mt-6 space-y-6">
        {parts.map((part) => (
          <section key={part.key} className="card p-4 lg:p-5" id={`survival-part-${part.key}`}>
            <h2 className="text-[15px] font-semibold text-ink">{part.label}</h2>
            <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {part.groups.flatMap((g) =>
                g.items.map((it) => (
                  <Link key={it.slug} to={`/${it.slug}`} className="block truncate rounded-control px-2 py-1.5 text-[13.5px] text-ink-2 hover:bg-bg-sunk hover:text-accent">
                    {it.title}
                  </Link>
                )),
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
