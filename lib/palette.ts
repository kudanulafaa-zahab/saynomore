export const PALETTES = ["sunrise", "aurora", "ember", "monochrome"] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_STORAGE_KEY = "snm-palette";
export const DEFAULT_PALETTE: Palette = "sunrise";

/** Liquid Glass frost dial: 0–100 in steps of 5; 50 = the hand-tuned default
 *  look (the CSS multipliers are exactly 1.0 there — see --glass-frost in
 *  globals.css). Stored as an integer percent. */
export const FROST_STORAGE_KEY = "snm-frost";
export const DEFAULT_FROST = 50;

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}

/** Small swatch previews for the picker — the 4 bokeh field colors per palette. */
export const PALETTE_SWATCHES: Record<Palette, { label: string; colors: [string, string, string, string] }> = {
  sunrise:    { label: "Sunrise",    colors: ["#ffd9a0", "#ffc4c9", "#bcd9f5", "#fff8ec"] },
  aurora:     { label: "Aurora",     colors: ["#9fe3d0", "#9cc7f0", "#c0b0f0", "#ffffff"] },
  ember:      { label: "Ember",      colors: ["#ff8a4d", "#e0568f", "#ffbe4d", "#fff0e0"] },
  monochrome: { label: "Monochrome", colors: ["#e2e2de", "#d8d8d4", "#ececea", "#ffffff"] },
};

/**
 * Inline script source applied via <script dangerouslySetInnerHTML> in the
 * root layout, BEFORE React hydrates — reads the stored palette choice and
 * sets data-palette on <html> immediately, so there's no flash of the
 * default (Sunrise) palette on load. Mirrors how next-themes avoids a
 * flash for light/dark via its own inline script.
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
