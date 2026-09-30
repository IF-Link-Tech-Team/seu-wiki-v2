// 长文阅读页（手册与经验共用）：宋体标题、文首署名/时间/来源信息块、桌面左侧目录树、
// 移动端顶部锚点、文末上一篇/下一篇连续阅读。
import { Link } from "react-router";
import type { DocDetail, SurvivalPartView } from "@aihot/contracts/site";
import { IconChevronLeft, IconChevronRight } from "../../components/icons";

function docHref(slug: string) {
  return `/${slug}`;
}

/** 目录树（桌面左侧）：篇 → 组 → 条目。 */
export function DocTree({ parts, activeSlug }: { parts: SurvivalPartView[]; activeSlug: string | null }) {
  return (
    <nav className="space-y-4 text-[13px] leading-relaxed" aria-label="手册目录">
      {parts.map((part) => (
        <details key={part.key} open={activeSlug ? part.groups.some((g) => g.items.some((i) => i.slug === activeSlug)) : part.key === "preface"}>
          <summary className="cursor-pointer select-none text-[13.5px] font-semibold text-ink">{part.label}</summary>
          <div className="mt-1.5 space-y-2 border-l border-line pl-3">
            {part.groups.map((g) => (
              <div key={g.key}>
                <div className="space-y-0.5">
                  {g.items.map((it) => (
                    <Link
                      key={it.slug}
                      to={docHref(it.slug)}
                      className={`block rounded-control px-2 py-1 ${it.slug === activeSlug ? "bg-accent-soft font-medium text-accent" : "text-ink-3 hover:bg-bg-sunk hover:text-ink"}`}
                    >
                      {it.title}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </details>
      ))}
    </nav>
  );
}

/** 移动端顶部锚点：章内小节跳转。 */
function AnchorBar({ doc }: { doc: DocDetail }) {
  const heads = doc.headings.filter((h) => h.depth <= 3);
  if (heads.length < 2) return null;
  return (
    <div className="scrollbar-none -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 lg:hidden">
      {heads.map((h) => (
        <a key={h.id} href={`#${h.id}`} className="chip shrink-0">
          {h.text.length > 14 ? `${h.text.slice(0, 14)}…` : h.text}
        </a>
      ))}
    </div>
  );
}

function MetaLine({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[12.5px] leading-relaxed">
      <span className="shrink-0 text-ink-4">{label}</span>
      <span className="min-w-0 text-ink-3">{children}</span>
    </div>
  );
}

export function DocPage({ doc, parts }: { doc: DocDetail; parts?: SurvivalPartView[] }) {
  return (
    <div className={parts ? "lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8" : ""}>
      {parts && (
        <aside className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100dvh-48px)] overflow-y-auto pb-6 pr-1">
            <Link to="/survival" className="mb-3 block text-[12.5px] text-ink-4 hover:text-accent">
              ← 手册目录
            </Link>
            <DocTree parts={parts} activeSlug={doc.slug} />
          </div>
        </aside>
      )}
      <article className="min-w-0 pb-10">
        <AnchorBar doc={doc} />
        <h1 className="font-serif text-[26px] font-bold leading-snug tracking-tight text-ink lg:text-[30px]">{doc.title}</h1>
        <div className="mt-3 space-y-1 rounded-panel bg-bg-sunk px-4 py-3">
          {doc.author && <MetaLine label="作者">{doc.author}</MetaLine>}
          {doc.occurredAt && <MetaLine label={doc.kind === "experience" ? "经历时间" : "原文时间"}>{doc.occurredAt}</MetaLine>}
          <MetaLine label="说明">长期内容以 Git 为编辑真源；时效注记（“更新：……”）保留在正文原处。{doc.kind === "experience" ? "个人经历不作为现行规则。" : ""}</MetaLine>
          {doc.sourceUrl && (
            <MetaLine label="来源">
              <a href={doc.sourceUrl} target="_blank" rel="noreferrer" className="break-all text-accent hover:underline">
                {doc.sourceUrl.includes("github.com") ? "编辑真源（GitHub）" : doc.sourceUrl}
              </a>
            </MetaLine>
          )}
        </div>
        {/* eslint-disable-next-line react/no-danger */}
        <div className="prose mt-6" dangerouslySetInnerHTML={{ __html: doc.html }} />
        <nav className="mt-10 flex items-stretch gap-3 border-t border-line pt-5" aria-label="连续阅读">
          {doc.prev ? (
            <Link to={docHref(doc.prev.slug)} className="group flex min-w-0 flex-1 items-center gap-2 rounded-panel px-3 py-2.5 ring-1 ring-line hover:ring-line-strong">
              <IconChevronLeft size={16} className="shrink-0 text-ink-4 group-hover:text-accent" />
              <span className="min-w-0">
                <span className="block text-[11.5px] text-ink-4">上一篇</span>
                <span className="block truncate text-[13px] text-ink-2 group-hover:text-ink">{doc.prev.title}</span>
              </span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          {doc.next ? (
            <Link to={docHref(doc.next.slug)} className="group flex min-w-0 flex-1 items-center justify-end gap-2 rounded-panel px-3 py-2.5 text-right ring-1 ring-line hover:ring-line-strong">
              <span className="min-w-0">
                <span className="block text-[11.5px] text-ink-4">下一篇</span>
                <span className="block truncate text-[13px] text-ink-2 group-hover:text-ink">{doc.next.title}</span>
              </span>
              <IconChevronRight size={16} className="shrink-0 text-ink-4 group-hover:text-accent" />
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      </article>
    </div>
  );
}
