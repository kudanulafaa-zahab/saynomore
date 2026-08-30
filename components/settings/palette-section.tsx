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

        {/* ── TWO PREVIEWS, NOT A SEGMENTED CONTROL ─────────────────────────
             With two mutually exclusive options the reflex answer is a
             segmented control, and it is the wrong one here. A segmented
             control names its options in words, and no word tells you what a
             palette looks like. Apple's own appearance picker (Settings →
             Display & Brightness) is two labelled PREVIEW TILES with a
             selected ring, for exactly this reason: when the thing being
             chosen is an appearance, show the appearance.
             Five options only ever fitted as small circles in a 4-up grid.
             Two leave room to show the real page gradient, so they do. */}
        <div className="grid grid-cols-2 gap-3">
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
                className="rounded-2xl p-2.5 flex flex-col items-center gap-2 transition active:scale-95"
                style={{
                  background: active ? "var(--glass-bg-2)" : "var(--glass-bg-1)",
                  border: active ? "1.5px solid var(--glass-accent)" : "0.5px solid var(--glass-border-lo)",
                }}
              >
                {/* data-palette-swatch: the material audit skips these. A
                    swatch is a PREVIEW of another theme, so it is the one place
                    in the app allowed to paint in a vocabulary that is not the
                    current one. Marked rather than special-cased by screen, so
                    the rest of Settings stays audited. */}
                {/* data-palette-swatch: the material audit skips these. A
                    preview is a picture of ANOTHER theme, so it is the one
                    place in the app allowed to paint in a vocabulary that is
                    not the current one. Marked rather than special-cased by
                    screen, so the rest of Settings stays audited.
                    Literal colours, not tokens: a palette's variables only
                    exist while it is active, so a token-drawn preview would
                    render flat on the palette you are switching AWAY from —
                    exactly when you most need to see what you are getting. */}
                <div
                  data-palette-swatch
                  className="relative w-full rounded-xl overflow-hidden"
                  style={{
                    aspectRatio: "16 / 10",
                    boxShadow: "inset 0 1px 1px rgba(255,255,255,0.4)",
                    // The page's own base tone under the bokeh, so the tile
                    // previews the whole surface rather than four floating
                    // blobs on nothing.
                    background: p === "ember" ? "#f8ede8" : "#eef3f4",
                  }}
                >
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
                      <Check className="h-6 w-6" style={{ color: "#fff" }} />
                    </div>
                  )}
                </div>
                {/* The name of the palette you are NOT on is a choice, not a
                    hint, so it is real foreground text (CLAUDE.md). It was
                    muted, which on this card measured as one of the greys the
                    contrast rule exists to stop. */}
                <span
                  className="ios-footnote font-semibold"
                  style={{ color: "var(--foreground)", opacity: active ? 1 : 0.85 }}
                >
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
              /* 44px, not 32: the HIG floor applies to the input's own box,
                 which is what a thumb-drag has to start inside. The visible
                 track is a separate absolutely-centred element and the thumb
                 stays 28px, so nothing about this looks different — there is
                 simply 6px more grabbable above and below the line. */
              .snm-frost-slider { -webkit-appearance: none; appearance: none; height: 44px; background: transparent; outline: none; cursor: pointer; }
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
