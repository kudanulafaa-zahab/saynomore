"use client";

// iOS-style swipe-to-reveal for list rows.
//
// Three deliberate constraints, each of which is the reason this works rather
// than fighting the browser:
//
// 1. LEFT SWIPE ONLY (actions sit on the right). A right-swipe would collide
//    with iOS Safari's edge-swipe-to-go-back, which the user cannot turn off
//    and which wins. Revealing on the left is a trap on this platform.
//
// 2. `touch-action: pan-y` on the row. This tells the browser: you keep
//    vertical scrolling, I take horizontal. Vertical scroll and the
//    rubber-band bounce stay fully native — we never preventDefault a scroll,
//    which is what the project's bounce rule requires.
//
// 3. Axis lock before engaging. A drag counts as horizontal only once it is
//    both past a small dead zone AND clearly more sideways than vertical.
//    Without this, a fast vertical flick that drifts a few pixels sideways
//    snags the row and the list feels broken.
//
// One row open at a time, tracked module-side: on iOS, opening a second row
// while one is already open is what closes the first.

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

export interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  /** Runs on tap. Navigation (tel:/wa.me) belongs here, not in an <a>. */
  onSelect: () => void;
  /** Background. Use a semantic token — this is a coloured surface. */
  background: string;
  foreground?: string;
}

const ACTION_W = 76;          // px per action — comfortably over the 44pt floor
const ENGAGE_PX = 12;         // dead zone before a drag is treated as a swipe
const AXIS_RATIO = 1.4;       // how much more horizontal than vertical it must be

// Identity is carried by a per-row token rather than the close function
// itself: a callback cannot compare against its own identity at the point it
// is being defined.
let openRow: { token: object; close: () => void } | null = null;

export function SwipeActions({
  actions, children, disabled = false,
}: {
  actions: SwipeAction[];
  children: React.ReactNode;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);

  const start = useRef<{ x: number; y: number; base: number } | null>(null);
  const axis = useRef<"undecided" | "horizontal" | "vertical">("undecided");
  const dragged = useRef(false);
  const token = useRef({});

  const openWidth = actions.length * ACTION_W;
  const active = actions.length > 0 && !disabled;

  const close = useCallback(() => {
    setAnimating(true);
    setOffset(0);
    if (openRow?.token === token.current) openRow = null;
  }, []);

  // A row scrolled off-screen mid-swipe must not stay registered as "open",
  // or the next row's swipe would try to close a component that is gone.
  useEffect(() => () => { if (openRow?.token === token.current) openRow = null; }, []);

  function onPointerDown(e: React.PointerEvent) {
    if (!active || e.pointerType === "mouse") return;
    start.current = { x: e.clientX, y: e.clientY, base: offset };
    axis.current = "undecided";
    dragged.current = false;
    setAnimating(false);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!active || !start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;

    if (axis.current === "undecided") {
      if (Math.abs(dx) < ENGAGE_PX && Math.abs(dy) < ENGAGE_PX) return;
      // Vertical wins ties — scrolling the list is the far more common intent.
      axis.current = Math.abs(dx) > Math.abs(dy) * AXIS_RATIO ? "horizontal" : "vertical";
      if (axis.current === "vertical") { start.current = null; return; }
      if (openRow && openRow.token !== token.current) openRow.close();
      openRow = { token: token.current, close };
    }

    dragged.current = true;
    const next = start.current.base + dx;
    // Clamp closed at 0; allow a little resistance past fully-open so it feels
    // elastic rather than hitting a wall.
    setOffset(Math.max(-openWidth - 24, Math.min(0, next)));
  }

  function onPointerUp() {
    if (!active || !start.current) { start.current = null; return; }
    start.current = null;
    if (axis.current !== "horizontal") return;
    setAnimating(true);
    // Past a third of the way = open. Anything less springs back.
    setOffset(offset < -openWidth / 3 ? -openWidth : 0);
    if (offset < -openWidth / 3) haptic("light");
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Actions sit underneath and are revealed, not translated in. */}
      {active && (
        <div className="absolute inset-y-0 right-0 flex" aria-hidden={offset === 0}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              tabIndex={offset === 0 ? -1 : 0}
              onClick={() => { a.onSelect(); close(); }}
              className="flex flex-col items-center justify-center gap-1 text-[11px] font-semibold"
              style={{ width: ACTION_W, background: a.background, color: a.foreground ?? "var(--snm-on-fill)" }}
            >
              {a.icon}
              {a.label}
            </button>
          ))}
        </div>
      )}

      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        // Suppress the tap that ends a swipe, so revealing actions never also
        // navigates into the row.
        onClickCapture={(e) => {
          if (dragged.current || offset !== 0) {
            e.preventDefault();
            e.stopPropagation();
            if (offset !== 0 && !dragged.current) close();
          }
          dragged.current = false;
        }}
        style={{
          transform: `translate3d(${offset}px,0,0)`,
          transition: animating ? "transform 260ms cubic-bezier(0.22,1,0.36,1)" : "none",
          touchAction: "pan-y",   // browser keeps vertical scroll + bounce
        }}
      >
        {children}
      </div>
    </div>
  );
}
