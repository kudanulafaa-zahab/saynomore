"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_PALETTE, PALETTE_STORAGE_KEY, isPalette, type Palette } from "@/lib/palette";

function readPalette(): Palette {
  if (typeof document === "undefined") return DEFAULT_PALETTE;
  const attr = document.documentElement.getAttribute("data-palette");
  return isPalette(attr) ? attr : DEFAULT_PALETTE;
}

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Reads/sets the current Liquid Glass palette (Sunrise/Aurora/Ember).
 *  Mirrors next-themes' useTheme() shape but for the separate data-palette
 *  attribute — see lib/palette.ts for the pre-paint inline script that
 *  avoids a flash of the default palette on load. */
export function usePalette() {
  const palette = useSyncExternalStore(subscribe, readPalette, () => DEFAULT_PALETTE);

  const setPalette = useCallback((next: Palette) => {
    document.documentElement.setAttribute("data-palette", next);
    try {
      localStorage.setItem(PALETTE_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — attribute is still set for this session */
    }
    listeners.forEach((l) => l());
  }, []);

  return { palette, setPalette };
}
