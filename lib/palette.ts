export const PALETTES = ["sunrise", "aurora", "ember"] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_STORAGE_KEY = "snm-palette";
export const DEFAULT_PALETTE: Palette = "sunrise";

export function isPalette(value: unknown): value is Palette {
  return typeof value === "string" && (PALETTES as readonly string[]).includes(value);
}

/** Small swatch previews for the picker — the 4 bokeh field colors per palette. */
export const PALETTE_SWATCHES: Record<Palette, { label: string; colors: [string, string, string, string] }> = {
  sunrise: { label: "Sunrise", colors: ["#ffd9a0", "#ffc4c9", "#ffe3b0", "#fff8ec"] },
  aurora:  { label: "Aurora",  colors: ["#9fe3d0", "#9cc7f0", "#c0b0f0", "#ffffff"] },
  ember:   { label: "Ember",   colors: ["#ff8a4d", "#e0568f", "#ffbe4d", "#fff0e0"] },
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
})();
`;
