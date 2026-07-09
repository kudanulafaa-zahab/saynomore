"use client";

import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { haptic } from "@/lib/haptics";

// Native iOS list-row pattern: Delete is never a persistent tap target next
// to the row (that's how a slightly-off tap on the row edge fires a
// destructive action by accident). Instead it lives BEHIND the row, revealed
// only by a deliberate leftward swipe — exactly how Mail/Messages do it.
//
// Content stays interactive (tap still navigates) until the drag passes a
// small threshold, at which point it's committed to a drag and the tap is
// suppressed so a swipe never also fires the row's own onClick/Link.
const REVEAL_WIDTH = 84; // px the row shifts to expose the Delete button
const DRAG_THRESHOLD = 8; // px of horizontal movement before we treat it as a swipe, not a tap

export function SwipeToDelete({
  onDelete,
  ariaLabel,
  children,
}: {
  onDelete: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [offset, setOffsetState] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const isHorizontal = useRef<boolean | null>(null);
  const revealed = useRef(false);
  // Mirrors `offset` state but read synchronously in onTouchEnd — React
  // batches the setOffset calls from onTouchMove, so a closure over the
  // `offset` STATE variable can read a stale pre-gesture value if touchend
  // fires before a re-render flushes (rare with real fingers, but a real
  // race nonetheless). The ref is always current.
  const offsetRef = useRef(0);
  function setOffset(v: number) { offsetRef.current = v; setOffsetState(v); }

  function onTouchStart(e: React.TouchEvent) {
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isHorizontal.current = null;
  }

  function onTouchMove(e: React.TouchEvent) {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;

    // Decide gesture direction once, on first meaningful movement — a
    // vertical scroll must never get hijacked into a horizontal swipe.
    if (isHorizontal.current === null && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
      isHorizontal.current = Math.abs(dx) > Math.abs(dy);
    }
    if (!isHorizontal.current) return;

    e.preventDefault(); // own this gesture once it's confirmed horizontal
    setDragging(true);
    const base = revealed.current ? -REVEAL_WIDTH : 0;
    const next = Math.min(0, Math.max(-REVEAL_WIDTH - 20, base + dx));
    setOffset(next);
    if (!revealed.current && next <= -REVEAL_WIDTH * 0.6) {
      revealed.current = true;
      haptic("light");
    }
  }

  function onTouchEnd() {
    setDragging(false);
    isHorizontal.current = null;
    if (offsetRef.current <= -REVEAL_WIDTH * 0.5) {
      setOffset(-REVEAL_WIDTH);
      revealed.current = true;
    } else {
      setOffset(0);
      revealed.current = false;
    }
  }

  function close() {
    setOffset(0);
    revealed.current = false;
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Delete affordance — sits behind the row, only exposed by the swipe */}
      <div className="absolute inset-y-0 right-0 flex items-stretch" style={{ width: REVEAL_WIDTH }}>
        <button
          onClick={() => { onDelete(); close(); }}
          aria-label={ariaLabel}
          className="flex-1 flex flex-col items-center justify-center gap-0.5 transition active:opacity-70"
          style={{ background: "var(--snm-error)", color: "#fff" }}
        >
          <Trash2 className="h-4 w-4" />
          <span className="text-[11px] font-semibold">Delete</span>
        </button>
      </div>

      {/* Opaque backing plate, page-background-colored, between the red
          delete layer and the row. This app's cards are deliberately
          translucent glass (rgba white ~9% + backdrop-blur), so without
          this the red would show through the card itself at rest, not just
          from a stacking bug — `position: relative` on the row alone isn't
          enough when the row's own background is see-through. */}
      <div className="absolute inset-0" style={{ background: "var(--background)" }} />

      {/* The row itself — shifts left on swipe; tap-through suppressed while
          dragging. */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClick={(e) => { if (revealed.current || dragging) { e.preventDefault(); e.stopPropagation(); close(); } }}
        className="relative"
        style={{
          transform: `translateX(${offset}px)`,
          transition: dragging ? "none" : "transform 200ms cubic-bezier(0.25, 0.1, 0.25, 1)",
          touchAction: "pan-y",
        }}
      >
        {children}
      </div>
    </div>
  );
}
