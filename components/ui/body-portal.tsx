"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renders children into <body>, escaping any ancestor stacking context.
 *
 * The app shell wraps every page in `<div className="relative z-[1]">` (needed
 * to sit above the glass wallpaper). That is its own stacking context, so a
 * fixed overlay rendered inline inside a page — however high its z-index — is
 * still trapped BELOW the Topbar and BottomNav (z-40 at the document root).
 * The chrome then paints over the sheet: actions in the header hide under the
 * top bar, and the translucent tab bar smears the sheet's content ("white
 * blob"). Portaling to <body> lifts the sheet out to the root so its z-index
 * competes with the chrome and it becomes a true modal above everything.
 *
 * The mounted guard keeps SSR safe (document exists only on the client).
 */
export function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
