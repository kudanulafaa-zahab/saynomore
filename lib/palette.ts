// TWO PALETTES. Ali, 2026-08-29: "Cut the five colors to 2 and delete all
// related content to the deleted themes."
//
// Sunrise, Soft and Lumen are gone — every rule, swatch, audit and CI step that
// belonged to them with it. Monochrome went the same way on 2026-08-10.
//
// The removal is safe on a phone that still has one of them stored: the init
// script below only accepts a name in this list, so a stale value falls back to
// the default rather than leaving the app unstyled.
//
// EMBER IS THE DEFAULT because Sunrise was, and Ember is the closer of the two
// survivors to it — warm, light base. A phone that had Sunrise lands somewhere
// familiar instead of on Aurora's teal.
//
// ── ONE MATERIAL NOW ────────────────────────────────────────────────────────
//
// Soft was CARVED (opaque, two shadows) and Lumen was EDGE-LIT (flat, a lit
// seam). Both are gone, so every surface in the app is Liquid Glass and there
// is no second physics to keep out of the first. The `material` field that used
// to mark them is gone with them; so is the swatch special-casing that had to
// preview a surface instead of a colour.
export const PALETTES = ["ember", "aurora"] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_STORAGE_KEY = "snm-palette";
export const DEFAULT_PALETTE: Palette = "ember";

/** Liquid Glass frost dial: 0–100 in steps of 5; 50 = the hand-tuned default
 *  look (the CSS multipliers are exactly 1.0 there — see --glass-frost in
 *  globals.css). Stored as an integer percent. */
export const FROST_STORAGE_KEY = "snm-frost";
export const DEFAULT_FROST = 50;

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}

/** The four bokeh field colours each palette paints its page gradient from —
 *  the same values as the CSS, so the picker previews the real thing. */
export const PALETTE_SWATCHES: Record<Palette, {
  label: string;
  colors: [string, string, string, string];
}> = {
  ember:  { label: "Ember",  colors: ["#ff8a4d", "#e0568f", "#ffbe4d", "#fff0e0"] },
  aurora: { label: "Aurora", colors: ["#9fe3d0", "#9cc7f0", "#c0b0f0", "#ffffff"] },
};

/**
 * Inline script source applied via <script dangerouslySetInnerHTML> in the
 * root layout, BEFORE React hydrates — reads the stored palette choice and
 * sets data-palette on <html> immediately, so there's no flash of the
 * default palette on load. Mirrors how next-themes avoids a flash for
 * light/dark via its own inline script.
 */
export const PALETTE_INIT_SCRIPT = `
(function() {
  try {
    var stored = localStorage.getItem(${JSON.stringify(PALETTE_STORAGE_KEY)});
    var valid = ${JSON.stringify(PALETTES)};
    var palette = valid.indexOf(stored) !== -1 ? stored : ${JSON.stringify(DEFAULT_PALETTE)};
    document.documentElement.setAttribute("data-palette", palette);
  } catch (e) {
    document.documentElement.setAttribute("data-palette", ${JSON.stringify(DEFAULT_PALETTE)});
  }
  try {
    var frost = parseInt(localStorage.getItem(${JSON.stringify(FROST_STORAGE_KEY)}) || "", 10);
    if (isNaN(frost) || frost < 0 || frost > 100) frost = ${DEFAULT_FROST};
    if (frost !== ${DEFAULT_FROST}) {
      document.documentElement.style.setProperty("--glass-frost", String(frost / 100));
    }
  } catch (e) { /* default frost stays — CSS fallback is 0.5 */ }
})();
`;
