"use client";

import { useEffect } from "react";

/**
 * Lock background page scroll while a modal / sheet is open — the iOS-correct way.
 *
 * On iOS Safari, `overflow:hidden` on <body> alone does NOT stop the page from
 * scrolling behind a fixed overlay. The reliable fix is to pin the body with
 * `position:fixed` at its current scroll offset, then restore that offset on
 * unlock. Without restoring scrollY the page would jump to the top on close.
 *
 * Single shared mechanism so every sheet in the app behaves identically — pass
 * `locked` (usually the sheet's open state). No-op on the server.
 *
 * Usage:
 *   useBodyScrollLock(isOpen);
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    const scrollY = window.scrollY;
    const prev = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top:      document.body.style.top,
      width:    document.body.style.width,
    };

    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top      = `-${scrollY}px`;
    document.body.style.width    = "100%";

    return () => {
      document.body.style.overflow = prev.overflow;
      document.body.style.position = prev.position;
      document.body.style.top      = prev.top;
      document.body.style.width    = prev.width;
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
