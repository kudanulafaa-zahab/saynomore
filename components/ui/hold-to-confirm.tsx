"use client";

// Press-and-hold confirmation for the two actions that destroy records which
// cannot be rebuilt: force-voiding a shipment, and deleting a sales order.
//
// Why a hold and not another tap: a second tap is the same gesture as the
// first, so a double-tap sails straight through it. A hold is a different
// gesture, and it cannot be produced by accident in a pocket or by a
// mis-aimed thumb.
//
// Why only two buttons use it: friction only works while it is rare. Put a
// hold on every delete and the thumb learns the hold, at which point it
// protects nothing and merely slows down the cheap actions.
//
// iOS note: `navigator.vibrate` is a no-op in Safari, so on Ali's phone
// there is NO haptic during the hold — the fill bar is the entire feedback
// channel and has to carry it alone. That is why the fill is the button's
// own background growing left-to-right at full opacity, not a hairline
// progress track: it has to be readable in Maldivian daylight, at a glance,
// while your thumb covers a third of the control.

import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

const HOLD_MS = 1200;

interface HoldToConfirmProps {
  /** Runs only after a complete, uninterrupted hold. */
  onConfirm: () => void;
  /** Resting label, e.g. "Hold to delete". */
  label: string;
  /** Shown while the action is in flight. */
  busyLabel?: string;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
}

export function HoldToConfirm({
  onConfirm, label, busyLabel, busy = false, disabled = false, className = "",
}: HoldToConfirmProps) {
  const [pct, setPct] = useState(0);
  const [slipped, setSlipped] = useState(false);
  const raf = useRef<number | null>(null);
  const startedAt = useRef(0);
  const fired = useRef(false);

  const stop = useCallback(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
  }, []);

  // A held pointer that survives an unmount would keep an rAF alive.
  useEffect(() => stop, [stop]);

  const begin = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || busy || raf.current !== null) return;
    // Stops the press turning into a scroll, a text selection, or iOS's
    // callout menu halfway through the hold.
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);

    fired.current = false;
    setSlipped(false);
    startedAt.current = performance.now();

    const tick = () => {
      const p = Math.min(100, ((performance.now() - startedAt.current) / HOLD_MS) * 100);
      setPct(p);
      if (p >= 100) {
        stop();
        if (!fired.current) {
          fired.current = true;
          haptic("warning"); // Android only; iOS Safari ignores it.
          onConfirm();
        }
        return;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, [disabled, busy, onConfirm, stop]);

  const release = useCallback(() => {
    if (raf.current === null) return;
    stop();
    // Only call it a slip if they actually got somewhere — a stray tap
    // shouldn't scold them.
    if (!fired.current && pct > 8) {
      setSlipped(true);
      window.setTimeout(() => setSlipped(false), 1800);
    }
    setPct(0);
  }, [pct, stop]);

  const armed = pct > 45;
  const inactive = disabled || busy;

  return (
    <div className={`flex flex-col ${className}`}>
      <button
        type="button"
        disabled={inactive}
        onPointerDown={begin}
        onPointerUp={release}
        onPointerCancel={release}
        onContextMenu={(e) => e.preventDefault()}
        aria-label={`${label}. Press and hold to confirm.`}
        className="relative h-[50px] w-full overflow-hidden rounded-2xl text-[15px] font-semibold disabled:opacity-40"
        style={{
          background: "transparent",
          color: "var(--snm-error)",
          border: "1px solid color-mix(in srgb, var(--snm-error) 38%, transparent)",
          touchAction: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
          WebkitTapHighlightColor: "transparent",
        }}
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0"
          style={{
            width: `${pct}%`,
            background: "var(--snm-error)",
            // No transition: the width is already driven frame-by-frame, and
            // easing it would make the bar lag the thumb and lie about
            // progress.
          }}
        />
        <span
          className="relative flex h-full items-center justify-center"
          style={{ color: armed ? "var(--snm-on-fill)" : "var(--snm-error)" }}
        >
          {busy ? (busyLabel ?? label) : label}
        </span>
      </button>

      <p
        className="mt-2 text-center text-[11.5px]"
        style={{ color: slipped ? "var(--snm-error)" : "var(--muted-foreground)" }}
        aria-live="polite"
      >
        {busy
          ? "Working…"
          : slipped
            ? "Let go too soon — nothing happened"
            : "Press and hold to confirm"}
      </p>
    </div>
  );
}
