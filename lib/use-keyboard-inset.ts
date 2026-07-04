"use client";

import { useEffect } from "react";

/**
 * Keep a bottom sheet's action button visible above the on-screen keyboard.
 *
 * On iOS the software keyboard does NOT resize the layout viewport — it just
 * slides up over the page, so a sheet pinned to the bottom (and its Save /
 * Confirm button) ends up hidden behind the keyboard. The reliable fix is the
 * visualViewport API: when the keyboard opens, `visualViewport.height` shrinks
 * by the keyboard height. We publish that gap as the CSS variable `--kb-inset`
 * on <html>, so any sheet can lift its footer with:
 *
 *   paddingBottom: max(env(safe-area-inset-bottom), var(--kb-inset))
 *
 * Single shared mechanism — pass the sheet's open state. No-op on the server
 * and on browsers without visualViewport (var stays 0px, layout unchanged).
 *
 * Usage:
 *   useKeyboardInset(isOpen);
 */
export function useKeyboardInset(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) return;

    const root = document.documentElement;

    const update = () => {
      // Gap between the layout viewport bottom and the visual viewport bottom
      // = keyboard height (plus any offset when the page is scrolled under it).
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb-inset", `${Math.round(inset)}px`);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);

    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      root.style.setProperty("--kb-inset", "0px");
    };
  }, [active]);
}
