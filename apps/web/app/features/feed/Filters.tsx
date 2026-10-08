// Feed filters: the tab row (精选 / 一手 / categories / 全部), the 信源 filter, and search.
import { useEffect, useRef, useState } from "react";
import { Form, Link, useLocation, useNavigate, useNavigation, useSearchParams } from "react-router";
import { CATEGORY_KEYS, CATEGORY_LABELS, CHANNEL_LABELS, type CategoryKey } from "@aihot/contracts/taxonomy";
import type { SourceOption } from "@aihot/contracts/site";
import { IconChevronDown, IconClose, IconSearch } from "../../components/icons";
import { PillTabs } from "../../components/ui/Tabs";

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
 * The feed's one tab row, shared by the home page and 全部动态: 精选（过门槛的精选集）、一手、
 * 各分类（该分类下收进来的全部条目），最后是全量的「全部」。切换 tab 时保留信源筛选。
 * 搜索词只属于 /all：搜索中点分类/一手是在结果内过滤（留在 /all），点「精选」才退出搜索回家。
 */
export function CategoryTabs({ active, layoutId, size = "md", className = "" }: { active: string; layoutId: string; size?: "md" | "sm"; className?: string }) {
  const [params] = useSearchParams();
  const searching = !!params.get("q")?.trim();
  const homeTab = (patch: Record<string, string | null>) =>
    hrefWith("/", params, { tag: null, q: null, tab: null, type: null, search: null, ...patch });
  const scopeTab = (patch: Record<string, string | null>) =>
    searching ? hrefWith("/all", params, { tag: null, ...patch }) : homeTab(patch);
  const items = [
    { key: "selected", label: "精选", to: homeTab({ channel: null, category: null }) },
    { key: "firstParty", label: CHANNEL_LABELS.firstParty, to: scopeTab({ channel: "firstParty", category: null }) },
    ...CATEGORY_KEYS.map((k: CategoryKey) => ({ key: k, label: CATEGORY_LABELS[k], to: scopeTab({ category: k, channel: null }) })),
    { key: "all", label: "全部", to: hrefWith("/all", params, { channel: null, category: null, tag: null, tab: null, type: null, search: null }) },
  ];
  return <PillTabs items={items} active={active} layoutId={layoutId} label="筛选" size={size} className={className} />;
}

/** 信源筛选（学院/部门）：一个弹出面板，按组列出信源，多选，选中的以可移除的 chip 呈现。 */
export function SourceFilter({ options, selected, className = "" }: { options: SourceOption[]; selected: string[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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
    navigate(s ? `?${s}` : "?", { preventScrollReset: true });
  };
  const toggle = (id: string) => apply(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);

  const byId = new Map(options.map((o) => [o.id, o]));
  const groups: Array<{ label: string; items: SourceOption[] }> = [];
  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options;
  for (const g of ["学院与书院", "机关与职能部门", "校级媒体与权益服务", "校区与社区空间", "学院", "机关", "校级", "公众号", null] as const) {
    const items = visible.filter((o) => o.group === g);
    if (items.length) groups.push({ label: g ?? "其他", items });
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex h-[42px] shrink-0 items-center gap-1.5 rounded-full bg-bg-sunk px-4 text-[14px] font-medium ring-1 ring-inset transition-colors ${
          selected.length ? "text-accent ring-accent/50" : "text-ink-3 ring-line-soft hover:text-ink hover:ring-line-strong"
        } dark:bg-bg-muted/60`}
      >
        学院/部门
        {selected.length > 0 && <span className="num text-[12px]">{selected.length}</span>}
        <IconChevronDown size={14} className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 flex max-h-[70vh] w-72 flex-col overflow-hidden rounded-panel bg-surface shadow-lg ring-1 ring-line">
          <div className="border-b border-line-soft p-2.5">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索信源…"
              className="h-9 w-full rounded-control bg-bg-sunk px-3 text-[13.5px] text-ink outline-none placeholder:text-ink-4 focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {groups.length === 0 && <p className="px-3 py-6 text-center text-[12.5px] text-ink-4">没有匹配的信源。</p>}
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-ink-4">{g.label}</div>
                {g.items.map((o) => {
                  const on = selected.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggle(o.id)}
                      aria-pressed={on}
                      className={`flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-[13px] transition-colors ${on ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-bg-sunk"}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{o.name}</span>
                      {on && <IconClose size={12} className="shrink-0" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
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
        <span className="sr-only">已选 {selected.length} 个信源：{selected.map((id) => byId.get(id)?.name ?? id).join("、")}</span>
      )}
    </div>
  );
}

/** 已选信源的可移除 chip 行（筛选生效时显示在 tab 行下面）。 */
export function SelectedSourceChips({ options, selected }: { options: SourceOption[]; selected: string[] }) {
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  if (selected.length === 0) return null;
  const byId = new Map(options.map((o) => [o.id, o]));
  const remove = (id: string) => {
    const next = selected.filter((x) => x !== id);
    return hrefWith(pathname, params, { sources: next.length ? next.join(",") : null });
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12px] text-ink-4">信源：</span>
      {selected.map((id) => (
        <Link key={id} to={remove(id)} preventScrollReset className="chip group border-accent/50 bg-accent-soft text-accent" aria-label={`移除信源 ${byId.get(id)?.name ?? id}`}>
          {byId.get(id)?.name ?? id}
          <IconClose size={11} className="opacity-60 transition-opacity group-hover:opacity-100" />
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
      if (e.key === "/" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement)?.isContentEditable)) {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ref]);
}

/**
 * Search field (GET /all?q=…). Desktop ("track"): at the end of the filter row as the same grey track,
 * at the height of md tabs, with a "/" hint. Phones ("bar"): full width with a separate 搜索 button.
 */
export function SearchField({ action = "/all", defaultValue = "", keep = {}, variant = "track", autoFocus = false }: { action?: string; defaultValue?: string; keep?: Record<string, string | null>; variant?: "track" | "bar"; autoFocus?: boolean }) {
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

  if (variant === "bar") {
    return (
      <Form method="get" action={action} role="search" className="flex gap-2">
        {hidden}
        <label className="relative flex-1">
          <span className="sr-only">搜索标题、摘要与正文</span>
          <IconSearch size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            ref={inputRef}
            name="q"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="搜索标题、摘要…"
            maxLength={200}
            autoComplete="off"
            enterKeyHint="search"
            className="h-11 w-full rounded-full border border-line-strong bg-surface pl-10 pr-9 text-[15px] text-ink outline-none transition-[border-color,box-shadow] placeholder:text-ink-4 focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)]"
          />
          {value && (
            <button type="button" aria-label="清空" onClick={() => { setValue(""); inputRef.current?.focus(); }} className="absolute right-2.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-full text-ink-4">
              <IconClose size={15} />
            </button>
          )}
        </label>
        <button type="submit" className={`h-11 shrink-0 rounded-full bg-accent px-5 text-[14.5px] font-semibold text-accent-contrast transition-[background-color,transform] active:scale-[0.98] ${searching ? "opacity-60" : ""}`}>
          搜索
        </button>
      </Form>
    );
  }

  return (
    <Form method="get" action={action} role="search" className="group relative w-full shrink-0 lg:w-60">
      {hidden}
      <label htmlFor="site-search" className="sr-only">
        搜索标题、摘要与正文
      </label>
      <IconSearch size={16} className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${searching ? "text-accent" : "text-ink-4 group-focus-within:text-ink-3"}`} />
      <input
        ref={inputRef}
        id="site-search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="搜索标题、摘要…"
        maxLength={200}
        autoComplete="off"
        className="h-[42px] w-full rounded-full bg-bg-sunk pl-10 pr-10 text-[14px] text-ink outline-none ring-1 ring-inset ring-line-soft transition-[background-color,box-shadow] placeholder:text-ink-4 hover:ring-line-strong focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] focus:ring-accent dark:bg-bg-muted/60 dark:focus:bg-surface"
      />
      {value ? (
        <button
          type="button"
          aria-label="清空"
          onClick={() => {
            setValue("");
            inputRef.current?.focus();
          }}
          className="absolute right-3 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-ink-4 transition-colors hover:bg-bg-sunk hover:text-ink"
        >
          <IconClose size={13} />
        </button>
      ) : (
        <kbd className="mono pointer-events-none absolute right-4 top-1/2 hidden -translate-y-1/2 rounded-mark border border-line-strong bg-surface px-1.5 text-[10.5px] leading-4 text-ink-4 lg:block">/</kbd>
      )}
    </Form>
  );
}

/** Mobile home: the search icon at the end of the category row opens search on 全部动态. */
export function SearchIconLink() {
  return (
    <Link to="/all?search=1" aria-label="搜索" className="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink">
      <IconSearch size={19} />
    </Link>
  );
}
