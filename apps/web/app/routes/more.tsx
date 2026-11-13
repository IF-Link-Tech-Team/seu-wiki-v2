import { SITE } from "@aihot/industry/site";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { pageMeta } from "../lib/seo";
import { ThemeSwitch } from "../components/shell/ThemeSwitch";
import { IconBook, IconBookmark, IconChart, IconChevronRight, IconFlame, IconHeart, IconHistory, IconList, IconMessage, IconMoon, IconPlug } from "../components/icons";

/** Shared caches may keep this page for five minutes. */
export function headers() {
  return { "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600" };
}

export function meta() {
  return pageMeta({ title: "更多", path: "/more", noindex: true });
}

type Row = { to: string; label: string; icon: ReactNode };

const GROUPS: Array<{ title: string; rows: Row[] }> = [
  {
    title: "内容",
    rows: [
      { to: "/handbook", label: "东大生存手册", icon: <IconBook size={18} /> },
      { to: "/all", label: "全部动态", icon: <IconList size={18} /> },
      { to: "/hot", label: "热点榜", icon: <IconFlame size={18} /> },
      { to: "/agent", label: "Agent 接入", icon: <IconPlug size={18} /> },
    ],
  },
  {
    title: "偏好",
    rows: [{ to: "/starred", label: "收藏", icon: <IconBookmark size={18} /> }],
  },
  {
    title: "关于",
    rows: [
      { to: "/about", label: `关于 ${SITE.name}`, icon: <IconHeart size={18} /> },
      { to: "/changelog", label: "更新日志", icon: <IconHistory size={18} /> },
      { to: "/feedback", label: "意见反馈", icon: <IconMessage size={18} /> },
    ],
  },
];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <h2 className="px-4 pb-1 pt-3 text-[13px] font-medium leading-normal text-ink-4">{title}</h2>
      <ul className="divide-y divide-line-soft">{children}</ul>
    </section>
  );
}

export default function MorePage() {
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      <h1 className="browse-title pb-4 pt-5 lg:pt-1">更多</h1>
      <div className="grid items-start gap-4 sm:grid-cols-2 2xl:grid-cols-3">
        {GROUPS.map((g) => (
          <Group key={g.title} title={g.title}>
            {g.rows.map((r) => (
              <li key={r.to}>
                <Link to={r.to} className="flex min-h-12 items-center gap-3 px-4 py-2 text-[15px] font-medium leading-normal text-ink transition-colors hover:bg-bg-sunk">
                  <span className="shrink-0 text-ink-3">{r.icon}</span>
                  <span className="min-w-0 flex-1">{r.label}</span>
                  <IconChevronRight size={16} className="shrink-0 text-ink-4" />
                </Link>
              </li>
            ))}
            {g.title === "偏好" && (
              <li className="flex min-h-12 items-center gap-3 px-4 py-2 text-[15px] font-medium leading-normal text-ink">
                <span className="text-ink-3">
                  <IconMoon size={18} />
                </span>
                <span className="flex-1">外观</span>
                <ThemeSwitch className="w-[124px]" />
              </li>
            )}
          </Group>
        ))}
      </div>
      <div className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-1 text-[12px] text-ink-4">
        <Link to="/terms" className="hover:text-ink-2">使用规则</Link>
        <Link to="/privacy" className="hover:text-ink-2">隐私说明</Link>
        <a href="/feed.xml" className="hover:text-ink-2">RSS</a>
        {SITE.icp && <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="hover:text-ink-2">{SITE.icp}</a>}
      </div>
    </div>
  );
}
