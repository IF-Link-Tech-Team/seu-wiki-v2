import { useEffect, useState, type ReactNode } from "react";
import { IconMonitor, IconMoon, IconSun } from "../icons";
import { resolvedTheme, setThemePreference, useThemePreference, type ThemePreference } from "../../lib/local-state";

type Choice = "dark" | "system" | "light";

const OPTIONS: Array<{ key: Choice; label: string; icon: ReactNode }> = [
  { key: "dark", label: "深色", icon: <IconMoon size={14} /> },
  { key: "system", label: "跟随系统", icon: <IconMonitor size={14} /> },
  { key: "light", label: "浅色", icon: <IconSun size={14} /> },
];

/** Three-way appearance switch (dark / follow the system / light) with a sliding thumb. */
export function ThemeSwitch({ className = "", onForest = false, compact = false }: { className?: string; onForest?: boolean; compact?: boolean }) {
  const pref = useThemePreference();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const current: Choice = !mounted ? "system" : (pref ?? "system");
  const index = OPTIONS.findIndex((o) => o.key === current);

  const choose = (key: Choice) => {
    const nextPref: ThemePreference = key === "system" ? null : key;
    const apply = () => {
      setThemePreference(nextPref);
      document.documentElement.setAttribute("data-theme", resolvedTheme(nextPref));
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(apply);
    else apply();
  };

  return (
    <div
      role="radiogroup"
      aria-label="外观"
      className={`relative grid grid-cols-3 rounded-full border ${compact ? "h-[28px] p-[2px]" : "h-[34px] p-[3px]"} ${
        onForest ? "border-[var(--forest-border)] bg-[var(--forest-dock-bg)] backdrop-blur-md" : "border-line bg-bg-sunk"
      } ${className}`}
    >
      <span
        aria-hidden="true"
        className={`absolute rounded-full border transition-transform duration-200 ease-[var(--ease-out-quart)] ${
          compact ? "inset-y-[2px] left-[2px] w-[calc((100%-4px)/3)]" : "inset-y-[3px] left-[3px] w-[calc((100%-6px)/3)]"
        } ${
          onForest ? "border-[var(--forest-glass-border)] bg-[var(--forest-glass-bg)] shadow-sm" : "border-line bg-surface shadow-[var(--shadow-card)]"
        }`}
        style={{ transform: `translateX(${index * 100}%)` }}
      />
      {OPTIONS.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={current === o.key}
          title={o.label}
          onClick={() => choose(o.key)}
          className={`relative z-10 flex items-center justify-center rounded-full transition-colors duration-150 ${compact ? "scale-90" : ""} ${
            onForest
              ? current === o.key ? "text-[var(--forest-glass-ink)]" : "text-[var(--forest-muted)] hover:text-[var(--forest-ink)]"
              : current === o.key ? "text-ink" : "text-ink-4 hover:text-ink-2"
          }`}
        >
          {o.icon}
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  );
}
