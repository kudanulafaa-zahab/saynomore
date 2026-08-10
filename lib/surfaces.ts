/**
 * The app's surface recipes, in one place.
 *
 * WHY THIS FILE EXISTS
 *
 * `CARD` was declared separately in nine components. They happened to agree on
 * 2026-08-10 only because they had all just been swept by hand; before that
 * they had drifted, and the drift is what made the Soft theme land unevenly —
 * the content blur was typed out in 22 components and shadows hardcoded in
 * eight more, where no theme could reach them.
 *
 * Nine copies is nine chances to miss one. One copy is none.
 *
 * WHAT THESE ARE, AND WHAT THEY ARE NOT
 *
 * Every value is a TOKEN, never a literal. That is what lets a palette change
 * the whole app: Soft points --glass-fill-* at an opaque carved base and
 * --glass-blur-content at `none`, and every surface below follows without a
 * single component knowing a theme exists.
 *
 * If you find yourself wanting a colour or a shadow that is not here, the
 * answer is a new token in globals.css and a new entry here — not a literal in
 * a component. `npm run audit:material` fails on literals, by design.
 *
 * These are inline style objects rather than classes because that is how the
 * app is written today (roughly 2,600 style props). Consolidating to
 * `.snm-card` is a worthwhile later change; the point of this file is that when
 * that day comes it is one file to edit instead of nine.
 *
 * ONE DELIBERATE CHANGE IN APPEARANCE
 *
 * Two functions inside competitors-view carried their own local `const CARD`
 * built on --glass-1 with --glass-inner and no border — a near-miss of the
 * shared recipe, sitting on the same screens as the real one. They now use
 * CARD. That is a small visual change and it is the point: two cards on one
 * screen that differ by a hairline is exactly the drift this file exists to
 * end. Contrast and material audits both pass after it.
 */

import type { CSSProperties } from "react";

/**
 * Content surface — cards, list rows, in-flow panels.
 * The thing most of the app is made of.
 */
export const CARD: CSSProperties = {
  background: "linear-gradient(180deg, var(--glass-fill-top), var(--glass-fill-bottom))",
  backdropFilter: "var(--glass-blur-content)",
  WebkitBackdropFilter: "var(--glass-blur-content)",
  border: "1px solid var(--glass-border, rgba(255,255,255,0.65))",
  boxShadow: "inset 0 1px 1px var(--glass-specular), var(--glass-shadow)",
};

/**
 * Denser surface — sheets, modals, anything floating ABOVE the page.
 *
 * The `-strong` fills are deliberately the ones a carved palette leaves
 * translucent: this is the chrome that keeps its Liquid Glass while content
 * around it is carved. Do not point a content card at this to "make it pop".
 */
export const CARD_L2: CSSProperties = {
  background: "linear-gradient(180deg, var(--glass-fill-top-strong), var(--glass-fill-bottom-strong))",
  backdropFilter: "var(--glass-blur-content)",
  WebkitBackdropFilter: "var(--glass-blur-content)",
  border: "1px solid var(--glass-border-strong, rgba(255,255,255,0.75))",
  boxShadow: "inset 0 1px 1px var(--glass-specular-strong), var(--glass-shadow-lg)",
};

/** CARD with the app's standard 16px corner already applied. */
export const CARD_ROUNDED: CSSProperties = { ...CARD, borderRadius: 16 };
