import { useState } from "react";
import { useLoaderData } from "react-router";
import type { Route } from "./+types/handbook";
import { IconBook, IconPen } from "../components/icons";
import { GuideContents, GuideReader, type GuideArticle, type GuideEntry } from "../features/docs/guide-2";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";

export async function loader({ request }: Route.LoaderArgs) {
  const [index, content] = await Promise.all([
    loadOr404<{ articles: GuideEntry[] }>("/api/site/guide/2", { signal: request.signal }),
    loadOr404<{ articles: GuideArticle[] }>("/api/site/guide/2/full", { signal: request.signal }),
  ]);
  return { entries: index.articles, articles: content.articles };
}

export function meta() {
  return pageMeta({ title: "SEU 生存指南 2.0", path: "/handbook" });
}

export function headers() { return { "Cache-Control": "public, max-age=0, s-maxage=300" }; }

function VersionSwitch({ version, onChange }: { version: "2.0" | "3.0"; onChange: (version: "2.0" | "3.0") => void }) {
  return <div role="group" aria-label="切换生存手册版本" className="relative grid h-[38px] w-[160px] grid-cols-2 rounded-full border border-line bg-bg-sunk p-[3px]">
    <span aria-hidden="true" className="absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/2)] rounded-full border border-line bg-surface shadow-[var(--shadow-card)] transition-transform duration-200 motion-reduce:transition-none" style={{ transform: `translateX(${version === "3.0" ? 100 : 0}%)` }} />
    {(["2.0", "3.0"] as const).map((choice) => <button key={choice} type="button" aria-label={`生存手册 ${choice}`} aria-pressed={version === choice} onClick={() => onChange(choice)} className={`relative z-10 flex items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold transition-colors ${version === choice ? "text-ink" : "text-ink-4 hover:text-ink-2"}`}>
      {choice === "2.0" ? <IconBook size={15} /> : <IconPen size={15} />}{choice}
    </button>)}
  </div>;
}

export default function Handbook() {
  const { entries, articles } = useLoaderData<typeof loader>();
  const [version, setVersion] = useState<"2.0" | "3.0">("2.0");
  const chooseVersion = (next: "2.0" | "3.0") => {
    if (next === version) return;
    setVersion(next);
    window.scrollTo({ top: 0 });
  };
  return <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
    <aside className="hidden lg:block">
      <div className="sticky top-6 max-h-[calc(100dvh-48px)] overflow-y-auto pb-6 pr-2">
        <div className="mb-4"><VersionSwitch version={version} onChange={chooseVersion} /></div>
        {version === "2.0" && <GuideContents articles={entries} />}
      </div>
    </aside>
    <div className="min-w-0">
      <div className="mt-5 lg:hidden"><VersionSwitch version={version} onChange={chooseVersion} /></div>
      {version === "2.0" ? <>
      <details className="mb-6 mt-5 rounded-panel border border-line p-3 lg:hidden">
        <summary className="cursor-pointer text-[14px] font-semibold text-ink">生存指南 2.0 目录</summary>
        <div className="mt-3 max-h-[50dvh] overflow-y-auto"><GuideContents articles={entries} /></div>
      </details>
      <GuideReader articles={articles} />
      </> : <section className="py-10 lg:pt-2">
        <h1 className="font-serif text-[26px] font-bold leading-snug text-ink lg:text-[30px]">生存手册 3.0</h1>
        <p className="mt-6 text-ink-3">尚未出炉，正在等待更多伙伴一起编纂。</p>
        <p className="mt-3 text-ink-3">如感兴趣，欢迎联系 <a className="text-accent hover:underline" href="mailto:FKKXTXD@163.com">FKKXTXD@163.com</a>，加入编纂团队。</p>
      </section>}
    </div>
  </div>;
}
