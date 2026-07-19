"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { usePalette } from "@/lib/use-palette";
import { PALETTES, PALETTE_SWATCHES, FROST_STORAGE_KEY, DEFAULT_FROST } from "@/lib/palette";
import { ThemeToggle } from "@/components/layout/theme-toggle";

function readFrost(): number {
  if (typeof window === "undefined") return DEFAULT_FROST;
  const v = parseInt(localStorage.getItem(FROST_STORAGE_KEY) ?? "", 10);
  return isNaN(v) || v < 0 || v > 100 ? DEFAULT_FROST : v;
}

export function PaletteSection() {
  const { palette, setPalette } = usePalette();

  // Liquid Glass frost dial — live preview: every glass surface on screen
  // (this very card included) retunes as the thumb moves, because the whole
  // material reads from the one --glass-frost variable.
  const [frost, setFrost] = useState(readFrost);
  function applyFrost(v: number) {
    setFrost(v);
    document.documentElement.style.setProperty("--glass-frost", String(v / 100));
    try { localStorage.setItem(FROST_STORAGE_KEY, String(v)); } catch { /* session-only */ }
  }

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

        {/* ── Glass finish — the Liquid Glass frost dial ──
             Clear (thin, see-through, light blur) ↔ Frosty (dense, bright
             rim light, heavy blur). 5% steps; 50% is the tuned default.
             Fills, hairline borders, specular rim and blur all move
             together — one material, one dial. */}
        <div className="pt-1">
          <div className="flex items-baseline justify-between mb-2">
            <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>Glass finish</p>
            <p className="ios-footnote snm-num" style={{ color: "var(--muted-foreground)" }}>
              {frost === DEFAULT_FROST ? "Default" : `${frost}%`}
            </p>
          </div>
          <div className="relative">
            <div
              className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full overflow-hidden pointer-events-none"
              style={{ background: "color-mix(in srgb, var(--foreground) 12%, transparent)" }}
            >
              <div className="h-full rounded-full" style={{ width: `${frost}%`, background: "var(--snm-brand)" }} />
            </div>
            <input
              type="range"
              min={0} max={100} step={5}
              value={frost}
              onChange={(e) => applyFrost(parseInt(e.target.value, 10))}
              aria-label="Glass finish, clear to frosty"
              className="snm-frost-slider relative w-full"
              style={{ touchAction: "none" }}
            />
            <style>{`
              .snm-frost-slider { -webkit-appearance: none; appearance: none; height: 32px; background: transparent; outline: none; cursor: pointer; }
              .snm-frost-slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 28px; height: 28px; border-radius: 50%; background: var(--snm-brand); border: 3px solid rgba(255,255,255,0.75); box-shadow: 0 2px 12px var(--snm-brand-muted); cursor: grab; }
              .snm-frost-slider::-moz-range-thumb { width: 28px; height: 28px; border-radius: 50%; background: var(--snm-brand); border: 3px solid rgba(255,255,255,0.75); box-shadow: 0 2px 12px var(--snm-brand-muted); cursor: grab; }
              .snm-frost-slider:active::-webkit-slider-thumb { cursor: grabbing; }
            `}</style>
          </div>
          <div className="flex justify-between mt-0.5">
            <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>Clear</p>
            <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>Frosty</p>
          </div>
        </div>
      </div>
    </section>
  );
}
