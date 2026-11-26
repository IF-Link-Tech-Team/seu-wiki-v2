// Feed filters: the tab row (精选 / 订阅 / categories), the unified search + source filter, and chips.
import { useEffect, useId, useRef, useState } from "react";
import { Form, Link, useLocation, useNavigate, useNavigation, useSearchParams } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS, type CategoryKey } from "@aihot/contracts/taxonomy";
import type { SourceOption } from "@aihot/contracts/site";
import { IconChevronDown, IconChevronLeft, IconChevronRight, IconClose, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";
import { groupSourceOptions, matchSourceOrgs, selectedSourceChips, SOURCE_GROUP_ORDER, type SourceRow } from "./sourceOrgs";

const CATEGORY_TAB_LABELS = { ...CATEGORY_LABELS, academic: "教学教务", aid: "奖助学金", competition: "科创竞赛" };

const CATEGORY_TAB_KEYS: CategoryKey[] = [
  ...CATEGORY_KEYS.filter((k) => k !== "life" && k !== "research-institution"),
  ...CATEGORY_KEYS.filter((k) => k === "research-institution"),
];

/** Same page with some query parameters changed (paging state dropped). */
export function hrefWith(base: string, params: URLSearchParams, patch: Record<string, string | null>) {
  const sp = new URLSearchParams(params);
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === "") sp.delete(k);
    else sp.set(k, v);
  }
  sp.delete("page");
  sp.delete("cursor");
  const s = sp.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * The feed's one tab row, shared by the home page and 全部动态: 精选（过门槛的精选集）、订阅占位、
 * 教学教务至校园新闻、科研机构的八个分类，最后是全量的「全部」。生活服务与全量列表保留原入口，切换 tab 时保留信源筛选。
 * 搜索词只属于 /all：搜索中点分类是在结果内过滤（留在 /all），点「精选」才退出搜索回家。
 */
export function CategoryTabs({ active, layoutId, size = "sm", className = "" }: { active: string; layoutId: string; size?: "md" | "sm" | "xs"; className?: string }) {
  const [params] = useSearchParams();
  const searching = !!params.get("q")?.trim();
  const homeTab = (patch: Record<string, string | null>) =>
    hrefWith("/", params, { tag: null, q: null, tab: null, type: null, search: null, ...patch });
  const scopeTab = (patch: Record<string, string | null>) =>
    searching ? hrefWith("/all", params, { tag: null, ...patch }) : homeTab(patch);
  const items = [
    { key: "selected", label: "精选", to: homeTab({ channel: null, category: null }) },
    { key: "subscription", label: "订阅", to: "/subscription" },
    ...CATEGORY_TAB_KEYS.map((k) => ({ key: k, label: CATEGORY_TAB_LABELS[k], to: scopeTab({ category: k, channel: null }) })),
    { key: "all", label: "全部", to: hrefWith("/all", params, { channel: null, category: null, tag: null, tab: null, type: null, search: null }) },
  ];
  return <PillTabs items={items} active={active} size={size} layoutId={layoutId} label="筛选" revealActive={active !== "all"} className={`lg:[scrollbar-color:var(--line-strong)_transparent] lg:[scrollbar-width:thin] ${className}`} />;
}

/** 面板里的一行栏目：点一下选中这组信源，再点取消。 */
function SourceRowButton({ label, ids, selected, onToggle }: { label: string; ids: string[]; selected: string[]; onToggle: (ids: string[]) => void }) {
  const on = ids.every((id) => selected.includes(id));
  return (
    <button
      type="button"
      onClick={() => onToggle(ids)}
      aria-pressed={on}
      className={`flex min-h-10 w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm leading-normal transition-colors ${on ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-bg-sunk"}`}
    >
      <span className="min-w-0 flex-1 wrap-anywhere">{label}</span>
      {on && <IconClose size={12} className="shrink-0" />}
    </button>
  );
}

function SourceRows({ rows, selected, onToggle }: { rows: SourceRow[]; selected: string[]; onToggle: (ids: string[]) => void }) {
  return rows.map((r) => <SourceRowButton key={r.label} label={r.label} ids={r.ids} selected={selected} onToggle={onToggle} />);
}

/** 信源筛选（学院/部门）：弹出面板一级列单位，点开后二级列单位下的栏目，多选，选中的以可移除的 chip 呈现。搜索时直接列出命中的栏目。 */
export function SourceFilter({ options, selected, className = "", onForest = false, compact = false, targetPath }: { options: SourceOption[]; selected: string[]; className?: string; onForest?: boolean; compact?: boolean; targetPath?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (next: string[]) => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    sp.delete("cursor");
    if (next.length) sp.set("sources", next.join(","));
    else sp.delete("sources");
    const s = sp.toString();
    const base = targetPath ?? "";
    navigate(base ? (s ? `${base}?${s}` : base) : (s ? `?${s}` : "?"), { preventScrollReset: true });
  };
  const toggle = (ids: string[]) => {
    const on = ids.every((id) => selected.includes(id));
    apply(on ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  const orgs = groupSourceOptions(options);
  const searching = !!query.trim();
  const matches = matchSourceOrgs(orgs, query);
  const current = searching ? undefined : orgs.find((o) => o.org === activeOrg);

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors ${compact ? "h-[38px] px-3.5 text-[13px]" : "h-11 px-3.5 text-[14px] sm:px-4"} ${
          onForest
            ? selected.length
              ? "bg-[var(--forest-gold)] text-[#163125] shadow-sm"
              : "glass-on-forest"
            : selected.length
              ? "bg-[var(--nav-active-bg)] text-[var(--nav-active-ink)] ring-1 ring-inset ring-[var(--nav-active-border)] shadow-[var(--shadow-thumb)]"
              : "bg-bg-sunk text-ink-3 ring-1 ring-inset ring-line-soft hover:text-ink hover:ring-line-strong"
        }`}
      >
        学院/部门
        {selected.length > 0 && <span className="num text-[12px]">{selected.length}</span>}
        <IconChevronDown size={14} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="glass-pop absolute right-0 z-30 mt-2 flex max-h-[60dvh] w-72 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-panel">
          <div className="border-b border-line-soft p-2.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="搜索信源"
              placeholder="搜索信源…"
              className="h-10 w-full rounded-control bg-bg-sunk px-3 text-base text-ink outline-none placeholder:text-ink-4 focus:ring-1 focus:ring-accent lg:text-sm"
            />
          </div>
          {current ? (
            <>
              <button type="button" onClick={() => setActiveOrg(null)} className="flex min-h-10 items-center gap-1 border-b border-line-soft px-2.5 py-2 text-left text-sm font-medium text-ink transition-colors hover:text-accent">
                <IconChevronLeft size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 wrap-anywhere">{current.org}</span>
              </button>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {current.rows.length > 1 && <SourceRowButton label={`全部（${current.rows.length} 个栏目）`} ids={current.ids} selected={selected} onToggle={toggle} />}
                <SourceRows rows={current.rows} selected={selected} onToggle={toggle} />
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
              {matches.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-ink-4">没有匹配的信源。</p>}
              {searching
                ? matches.map((o) => (
                    <div key={o.org}>
                      <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-ink-4">{o.org}</div>
                      <SourceRows rows={o.rows} selected={selected} onToggle={toggle} />
                    </div>
                  ))
                : SOURCE_GROUP_ORDER.map((group) => {
                    const items = matches.filter((o) => o.group === group);
                    if (items.length === 0) return null;
                    return (
                      <div key={group}>
                        <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-ink-4">{group}</div>
                        {items.map((o) => {
                          const count = o.ids.filter((id) => selected.includes(id)).length;
                          return (
                            <button
                              key={o.org}
                              type="button"
                              onClick={() => setActiveOrg(o.org)}
                              className={`flex min-h-10 w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-sm leading-normal transition-colors hover:bg-bg-sunk ${count ? "text-accent" : "text-ink-2"}`}
                            >
                              <span className="min-w-0 flex-1 wrap-anywhere">{o.org}</span>
                              {count > 0 && <span className="num shrink-0 text-[12px]">{count}</span>}
                              <IconChevronRight size={13} className="shrink-0 text-ink-4" />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
            </div>
          )}
          {selected.length > 0 && (
            <div className="border-t border-line-soft p-2">
              <button type="button" onClick={() => apply([])} className="w-full rounded-control py-1.5 text-[12.5px] text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink">
                清除全部信源筛选
              </button>
            </div>
          )}
        </div>
      )}

      {selected.length > 0 && !open && (
        <span className="sr-only">已选 {selected.length} 个信源：{selectedSourceChips(orgs, selected).map((c) => c.label).join("、")}</span>
      )}
    </div>
  );
}

/** 已选信源的可移除 chip 行（筛选生效时显示在 tab 行下面）。 */
export function SelectedSourceChips({ options, selected }: { options: SourceOption[]; selected: string[] }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  if (selected.length === 0) return null;
  const remove = (ids: string[]) => {
    const next = selected.filter((x) => !ids.includes(x));
    return hrefWith(pathname, params, { sources: next.length ? next.join(",") : null });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink-4">信源：</span>
      {selectedSourceChips(groupSourceOptions(options), selected).map((c) => (
        <Link key={c.label} to={remove(c.ids)} preventScrollReset className="chip group h-auto min-h-8 min-w-0 bg-accent-soft py-1 text-accent" aria-label={`移除信源 ${c.label}`}>
          <span className="min-w-0 wrap-anywhere">{c.label}</span>
          <IconClose size={11} className="shrink-0 opacity-60 transition-opacity group-hover:opacity-100" />
        </Link>
      ))}
      <Link to={hrefWith(pathname, params, { sources: null })} preventScrollReset className="text-[12px] text-ink-4 hover:text-accent">
        清除
      </Link>
    </div>
  );
}

function useSlashFocus(ref: React.RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const input = ref.current;
      if (e.key === "/" && input?.getClientRects().length && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        input.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/**
 * Search field (GET /all?q=…). The search page shows a full-width field and submit button on small screens.
 */
export function SearchField({ action = "/all", defaultValue = "", keep = {}, variant = "track", autoFocus = false, onForest = false, compact = false }: { action?: string; defaultValue?: string; keep?: Record<string, string | null>; variant?: "track" | "bar"; autoFocus?: boolean; onForest?: boolean; compact?: boolean }) {
  const [value, setValue] = useState(defaultValue);
  const navigation = useNavigation();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setValue(defaultValue), [defaultValue]);
  useSlashFocus(inputRef);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const searching = navigation.state === "loading" && navigation.location?.pathname === action && !!new URLSearchParams(navigation.location.search).get("q");
  const hidden = Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));

  return (
    <Form method="get" action={action} role="search" className={`col-span-full flex min-w-0 gap-2 lg:col-auto ${compact ? "lg:w-48 xl:w-56" : "lg:w-60"}`}>
      {hidden}
      <div className="group relative min-w-0 flex-1">
        <label htmlFor="site-search" className="sr-only">搜索标题、摘要与正文</label>
        <IconSearch size={compact ? 15 : 16} className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${onForest ? "text-[var(--forest-muted)]" : searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
        <input
          ref={inputRef}
          id="site-search"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="搜索标题、摘要…"
          maxLength={200}
          autoComplete="off"
          enterKeyHint="search"
          className={`w-full rounded-full pl-9 text-base outline-none transition-[background-color,box-shadow,border-color] ${compact ? "h-[38px] lg:text-[13px]" : "h-11 lg:text-sm"} ${
            onForest
              ? "glass-on-forest placeholder:text-[var(--forest-muted)] focus:bg-white/20 focus:ring-2 focus:ring-[var(--forest-gold)]/70"
              : "bg-bg-sunk text-ink ring-1 ring-inset ring-line-soft placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent"
          } ${value ? "pr-10" : "pr-3 lg:pr-9"}`}
        />
        {value ? (
          <button
            type="button"
            aria-label="清空"
            onClick={() => {
              setValue("");
              inputRef.current?.focus();
            }}
            className={`absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-full transition-colors ${onForest ? "text-[var(--forest-muted)] hover:bg-white/15 hover:text-white" : "text-ink-4 hover:bg-bg-sunk hover:text-ink"}`}
          >
            <IconClose size={15} />
          </button>
        ) : (
          <kbd className={`mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border px-1.5 text-[10.5px] leading-4 lg:block ${onForest ? "border-white/25 bg-white/10 text-[var(--forest-muted)]" : "border-line-strong bg-surface text-ink-4"}`}>/</kbd>
        )}
      </div>
      {variant === "bar" && (
        <button type="submit" className={`h-11 shrink-0 rounded-full bg-accent-soft px-4 text-sm font-semibold text-accent transition-colors hover:bg-bg-muted lg:hidden ${searching ? "opacity-60" : ""}`}>
          搜索
        </button>
      )}
    </Form>
  );
}

/** Mobile home: the search icon at the end of the category row opens search on 全部动态. */
export function SearchIconLink({ onForest = false }: { onForest?: boolean }) {
  return (
    <Link
      to="/all?search=1"
      aria-label="搜索"
      className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-colors ${onForest ? "glass-on-forest" : "bg-bg-sunk text-ink-3 hover:text-ink"}`}
    >
      <IconSearch size={18} />
    </Link>
  );
}

/**
 * Unified command box: merges article search and 学院/部门 source filtering into one control.
 * Focusing opens the frosted-glass source panel; typing live-matches sources below while Enter searches all articles.
 */
export function UnifiedSearchFilter({
  options,
  selected,
  action = "/all",
  defaultValue = "",
  keep = {},
  autoFocus = false,
  targetPath,
  className = "",
}: {
  options: SourceOption[];
  selected: string[];
  action?: string;
  defaultValue?: string;
  keep?: Record<string, string | null>;
  autoFocus?: boolean;
  targetPath?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(defaultValue);
  const [activeOrg, setActiveOrg] = useState<string | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  useEffect(() => setValue(defaultValue), [defaultValue]);
  useEffect(() => {
    if (autoFocus) {
      inputRef.current?.focus();
      setOpen(true);
    }
  }, [autoFocus]);

  useEffect(() => {
    const onSlash = (e: KeyboardEvent) => {
      const input = inputRef.current;
      if (e.key === "/" && input?.getClientRects().length && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        input.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onSlash);
    return () => window.removeEventListener("keydown", onSlash);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const applySources = (next: string[]) => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    sp.delete("cursor");
    if (next.length) sp.set("sources", next.join(","));
    else sp.delete("sources");
    const s = sp.toString();
    const base = targetPath ?? "";
    navigate(base ? (s ? `${base}?${s}` : base) : (s ? `?${s}` : "?"), { preventScrollReset: true });
  };
  const toggleSources = (ids: string[]) => {
    const on = ids.every((id) => selected.includes(id));
    applySources(on ? selected.filter((id) => !ids.includes(id)) : [...new Set([...selected, ...ids])]);
  };

  const orgs = groupSourceOptions(options);
  const trimmed = value.trim();
  const searchingSources = !!trimmed;
  const matches = matchSourceOrgs(orgs, value);
  const current = searchingSources ? undefined : orgs.find((o) => o.org === activeOrg);
  const navigating = navigation.state === "loading" && navigation.location?.pathname === action && !!new URLSearchParams(navigation.location.search).get("q");
  const hidden = Object.entries(keep).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null));

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <Form
        method="get"
        action={action}
        role="search"
        onSubmit={() => setOpen(false)}
        className="group relative flex min-w-0 items-center"
      >
        {hidden}
        <label htmlFor={inputId} className="sr-only">搜索标题、摘要或筛选学院与信源</label>
        <IconSearch
          size={15}
          className={`pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 transition-colors ${navigating || open ? "text-accent" : "text-ink-4 group-focus-within:text-accent"}`}
        />
        <input
          ref={inputRef}
          id={inputId}
          name="q"
          value={value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setValue(e.target.value);
            if (!open) setOpen(true);
          }}
          aria-expanded={open}
          aria-autocomplete="list"
          placeholder="搜索内容或筛选学院/信源…"
          maxLength={200}
          autoComplete="off"
          enterKeyHint="search"
          className={`h-[38px] w-full rounded-full bg-bg-sunk pl-9 text-[13px] text-ink outline-none ring-1 ring-inset transition-[background-color,box-shadow,border-color] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent ${
            open || selected.length ? "ring-[var(--nav-active-border)] bg-surface" : "ring-line-soft"
          } ${value ? (selected.length ? "pr-20" : "pr-9") : selected.length ? "pr-20" : "pr-9"}`}
        />
        <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={`已选 ${selected.length} 个信源`}
              className="num inline-flex h-6 items-center gap-1 rounded-full bg-[var(--nav-active-bg)] px-2 text-[11px] font-semibold text-[var(--nav-active-ink)] ring-1 ring-inset ring-[var(--nav-active-border)]"
            >
              <span>信源 {selected.length}</span>
            </button>
          )}
          {value ? (
            <button
              type="button"
              aria-label="清空"
              onClick={() => {
                setValue("");
                inputRef.current?.focus();
              }}
              className="grid size-7 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
            >
              <IconClose size={14} />
            </button>
          ) : (
            <kbd className="mono pointer-events-none mr-1.5 hidden rounded-mark border border-line-strong bg-surface px-1.5 text-[10px] leading-4 text-ink-4 lg:block">/</kbd>
          )}
        </div>
      </Form>

      {open && (
        <div className="glass-pop absolute right-0 z-30 mt-2 flex max-h-[62dvh] w-full min-w-[288px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-panel lg:w-[336px]">
          {trimmed && (
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                const sp = new URLSearchParams();
                for (const [k, v] of Object.entries(keep)) if (v) sp.set(k, v);
                sp.set("q", trimmed);
                navigate(`${action}?${sp.toString()}`);
              }}
              className="flex items-center gap-2 border-b border-line-soft bg-[var(--nav-active-bg)]/55 px-3 py-2.5 text-left text-[13px] font-medium text-[var(--nav-active-ink)] transition-colors hover:bg-[var(--nav-active-bg)]"
            >
              <IconSearch size={14} className="shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">
                搜索全站文章 “<span className="font-bold">{trimmed}</span>”
              </span>
              <span className="shrink-0 text-[11px] text-ink-4">回车 ↵</span>
            </button>
          )}

          {current ? (
            <>
              <button
                type="button"
                onClick={() => setActiveOrg(null)}
                className="flex min-h-10 items-center gap-1 border-b border-line-soft px-3 py-2 text-left text-sm font-semibold text-ink transition-colors hover:text-accent"
              >
                <IconChevronLeft size={14} className="shrink-0" />
                <span className="min-w-0 flex-1 wrap-anywhere">{current.org}</span>
              </button>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scrollbar-thin">
                {current.rows.length > 1 && <SourceRowButton label={`全部（${current.rows.length} 个栏目）`} ids={current.ids} selected={selected} onToggle={toggleSources} />}
                <SourceRows rows={current.rows} selected={selected} onToggle={toggleSources} />
              </div>
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 scrollbar-thin">
              <div className="flex items-center justify-between px-2.5 pb-1 pt-1.5 text-[11px] font-semibold tracking-[0.04em] text-ink-4">
                <span>{searchingSources ? "匹配的学院与信源" : "按学院/部门筛选信源"}</span>
                {options.length > 0 && !searchingSources && <span className="num font-normal">{orgs.length} 个单位</span>}
              </div>
              {matches.length === 0 ? (
                <p className="px-3 py-5 text-center text-[12.5px] text-ink-4">
                  {searchingSources ? "未匹配到学院或信源，按回车直接搜索全站内容。" : "暂无可筛选信源。"}
                </p>
              ) : searchingSources ? (
                matches.map((o) => (
                  <div key={o.org}>
                    <div className="px-2.5 pb-0.5 pt-2 text-[11.5px] font-semibold text-accent">{o.org}</div>
                    <SourceRows rows={o.rows} selected={selected} onToggle={toggleSources} />
                  </div>
                ))
              ) : (
                SOURCE_GROUP_ORDER.map((group) => {
                  const items = matches.filter((o) => o.group === group);
                  if (items.length === 0) return null;
                  return (
                    <div key={group}>
                      <div className="px-2.5 pb-0.5 pt-2 text-[11px] font-medium text-ink-4">{group}</div>
                      {items.map((o) => {
                        const count = o.ids.filter((id) => selected.includes(id)).length;
                        return (
                          <button
                            key={o.org}
                            type="button"
                            onClick={() => setActiveOrg(o.org)}
                            className={`flex min-h-9 w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-[13.5px] leading-normal transition-colors hover:bg-bg-sunk ${count ? "font-semibold text-accent" : "text-ink-2"}`}
                          >
                            <span className="min-w-0 flex-1 wrap-anywhere">{o.org}</span>
                            {count > 0 && <span className="num shrink-0 rounded-full bg-[var(--nav-active-bg)] px-1.5 text-[11px] text-[var(--nav-active-ink)]">{count}</span>}
                            <IconChevronRight size={13} className="shrink-0 text-ink-4" />
                          </button>
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {selected.length > 0 && (
            <div className="border-t border-line-soft p-2">
              <button
                type="button"
                onClick={() => applySources([])}
                className="w-full rounded-control py-1.5 text-[12.5px] font-medium text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink"
              >
                清除全部已选信源（{selected.length}）
              </button>
            </div>
          )}
        </div>
      )}

      {selected.length > 0 && !open && (
        <span className="sr-only">已选 {selected.length} 个信源：{selectedSourceChips(orgs, selected).map((c) => c.label).join("、")}</span>
      )}
    </div>
  );
}
