"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { useSyncExternalStore } from "react";

const OPTIONS = [
  { value: "system", Icon: Monitor, label: "System" },
  { value: "light",  Icon: Sun,     label: "Light"  },
  { value: "dark",   Icon: Moon,    label: "Dark"   },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // True after hydration, false during SSR — no effect/re-render needed.
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  if (!mounted) {
    return (
      <div
        className="flex rounded-lg overflow-hidden shrink-0"
        style={{ background: "var(--secondary)", padding: 2 }}
      >
        {OPTIONS.map((o) => (
          <div key={o.value} className="w-7 h-7 rounded-md" />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex rounded-lg shrink-0"
      style={{ background: "var(--secondary)", padding: 2, gap: 1 }}
    >
      {OPTIONS.map(({ value, Icon, label }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            onClick={() => setTheme(value)}
            title={label}
            aria-label={`${label} theme`}
            aria-pressed={active}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all duration-150"
            style={{
              background: active ? "var(--foreground)" : "transparent",
              color: active ? "var(--background)" : "var(--muted-foreground)",
            }}
          >
            <Icon className="h-[13px] w-[13px]" />
          </button>
        );
      })}
    </div>
  );
}
