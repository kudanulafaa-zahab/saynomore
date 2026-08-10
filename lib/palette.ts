// Monochrome removed 2026-08-10 at Ali's request ("You can delete the monochrome
// theme"). Anyone whose phone still has it stored is handled for free: the init
// script below only accepts a name that is in this list, so a stale value falls
// back to Sunrise rather than leaving the app unstyled.
export const PALETTES = ["sunrise", "aurora", "ember", "soft"] as const;
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

/** Small swatch previews for the picker — the 4 bokeh field colors per palette.
 *  `material: "carved"` means the swatch should preview the SURFACE instead of
 *  the colours: Soft's identity is how a surface is shaped, not what hue it is,
 *  and a bokeh ball advertises a colour scheme it does not have. */
export const PALETTE_SWATCHES: Record<Palette, {
  label: string;
  colors: [string, string, string, string];
  material?: "carved";
}> = {
  sunrise:    { label: "Sunrise",    colors: ["#ffd9a0", "#ffc4c9", "#bcd9f5", "#fff8ec"] },
  aurora:     { label: "Aurora",     colors: ["#9fe3d0", "#9cc7f0", "#c0b0f0", "#ffffff"] },
  ember:      { label: "Ember",      colors: ["#ff8a4d", "#e0568f", "#ffbe4d", "#fff0e0"] },
  // Soft is a MATERIAL, not a colour scheme — its swatch shows the carve
  // (light rim, base, shade) rather than four hues it doesn't have.
  soft:       { label: "Soft",       colors: ["#ffffff", "#e6e9ee", "#dfe3ea", "#a0acbe"], material: "carved" },
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
