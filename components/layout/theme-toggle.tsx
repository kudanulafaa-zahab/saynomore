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
          <div key={o.value} className="w-11 h-11 rounded-md" />
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
            // 44pt, not 28. Three theme buttons sit in the chrome of EVERY
            // screen, so this one control was most of the app's touch-target
            // debt on its own — 3 of the 14-24 undersized controls counted per
            // screen, on all twenty of them. The GLYPH stays small; it is the
            // hit box that grows, which is what a tap actually lands on.
            className="w-11 h-11 rounded-md flex items-center justify-center transition-all duration-150"
            style={{
              background: active ? "var(--foreground)" : "transparent",
              color: active ? "var(--background)" : "var(--muted-foreground)",
            }}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
