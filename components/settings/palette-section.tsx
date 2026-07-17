"use client";

import { Check } from "lucide-react";
import { usePalette } from "@/lib/use-palette";
import { PALETTES, PALETTE_SWATCHES } from "@/lib/palette";
import { ThemeToggle } from "@/components/layout/theme-toggle";

export function PaletteSection() {
  const { palette, setPalette } = usePalette();

  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{
        background: "var(--glass-1)",
        border: "0.5px solid var(--glass-border-lo)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
      }}
    >
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>Appearance</p>
            <p className="ios-subhead mt-0.5" style={{ color: "var(--muted-foreground)" }}>
              Pick a palette, then choose light, dark, or follow the system
            </p>
          </div>
          <ThemeToggle />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {PALETTES.map((p) => {
            const { label, colors } = PALETTE_SWATCHES[p];
            const active = palette === p;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPalette(p)}
                aria-pressed={active}
                aria-label={`${label} palette`}
                className="rounded-xl p-3 flex flex-col items-center gap-2 transition active:scale-95"
                style={{
                  background: active ? "var(--glass-bg-2)" : "var(--glass-bg-1)",
                  border: active ? "1.5px solid var(--glass-accent)" : "0.5px solid var(--glass-border-lo)",
                }}
              >
                <div className="relative h-12 w-12 rounded-full overflow-hidden" style={{ boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4)" }}>
                  <div
                    className="absolute inset-0"
                    style={{
                      background: [
                        `radial-gradient(circle at 30% 25%, ${colors[0]} 0%, transparent 55%)`,
                        `radial-gradient(circle at 75% 30%, ${colors[1]} 0%, transparent 50%)`,
                        `radial-gradient(circle at 30% 75%, ${colors[2]} 0%, transparent 55%)`,
                        `radial-gradient(circle at 70% 75%, ${colors[3]} 0%, transparent 50%)`,
                      ].join(", "),
                    }}
                  />
                  {active && (
                    <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.15)" }}>
                      <Check className="h-5 w-5" style={{ color: "#fff" }} />
                    </div>
                  )}
                </div>
                <span className="ios-footnote font-semibold" style={{ color: active ? "var(--foreground)" : "var(--muted-foreground)" }}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
