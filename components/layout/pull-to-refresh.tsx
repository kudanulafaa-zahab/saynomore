"use client";

// The visible half of pull-to-refresh. See lib/use-pull-to-refresh.ts for why
// this never calls preventDefault.
//
// The indicator is position:fixed, which on iOS means it does NOT travel with
// the rubber-band — the page content bounces away from underneath the topbar
// and reveals the spinner sitting behind it. That is exactly how Mail and
// Messages behave, and it comes for free precisely because we let the native
// bounce do the moving.

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ArrowDown } from "lucide-react";
import { PULL_THRESHOLD, documentScrollTop, runRefreshHandlers } from "@/lib/use-pull-to-refresh";
import { haptic } from "@/lib/haptics";

export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);

  const startY = useRef<number | null>(null);
  const armedAt = useRef(false);   // was the gesture started at the very top?
  const buzzed = useRef(false);    // fire the "you can let go" tick only once

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      // router.refresh covers server-rendered screens (the Dashboard reads its
      // figures server-side); registered handlers cover client screens that
      // fetch in the browser. Most pages need only one of the two, and doing
      // both is cheap and means no screen is silently un-refreshable.
      router.refresh();
      await runRefreshHandlers();
      // The spinner should be visible long enough to read as a response.
      // Without this a warm cache makes it flash and look like nothing ran.
      await new Promise((r) => setTimeout(r, 350));
    } finally {
      setBusy(false);
      setPull(0);
    }
  }, [router]);

  useEffect(() => {
    // Desktop has no rubber-band and a mouse user has a Refresh button.
    if (typeof window === "undefined" || !("ontouchstart" in window)) return;

    function onStart(e: TouchEvent) {
      if (busy || e.touches.length !== 1) return;
      armedAt.current = documentScrollTop() <= 0;
      startY.current = e.touches[0].clientY;
      buzzed.current = false;
    }

    function onMove(e: TouchEvent) {
      if (!armedAt.current || busy || startY.current === null) return;

      const top = documentScrollTop();
      // iOS: scrollTop goes negative during the bounce, so it IS the pull.
      // Elsewhere it clamps at 0, so fall back to finger travel while pinned.
      const overscroll = top < 0
        ? -top
        : top === 0
          ? Math.max(0, e.touches[0].clientY - startY.current)
          : 0;

      // Scrolled back down into content — cancel, don't leave it half-armed.
      if (top > 0) { armedAt.current = false; setPull(0); return; }

      // Resisted travel: the indicator should lag the finger so the gesture
      // feels weighted rather than pinned to the thumb.
      setPull(Math.min(PULL_THRESHOLD * 1.6, overscroll * 0.6));

      if (!buzzed.current && overscroll * 0.6 >= PULL_THRESHOLD) {
        buzzed.current = true;
        haptic("light"); // Android only; iOS Safari ignores it.
      }
    }

    function onEnd() {
      if (!armedAt.current) { setPull(0); return; }
      armedAt.current = false;
      startY.current = null;
      setPull((p) => {
        if (p >= PULL_THRESHOLD && !busy) { void finish(); return PULL_THRESHOLD; }
        return 0;
      });
    }

    // Passive throughout — this is what keeps the bounce alive.
    const opts = { passive: true } as const;
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd, opts);
    window.addEventListener("touchcancel", onEnd, opts);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [busy, finish]);

  if (pull <= 0 && !busy) return null;

  const ready = pull >= PULL_THRESHOLD;
  const progress = Math.min(1, pull / PULL_THRESHOLD);

  return (
    <div
      aria-hidden
      className="fixed left-0 right-0 z-[60] flex justify-center pointer-events-none"
      style={{ top: "calc(52px + env(safe-area-inset-top, 0px) + 6px)" }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full"
        style={{
          background: "var(--glass-bg-2)",
          border: "0.5px solid var(--glass-border-lo)",
          boxShadow: "var(--glass-shadow-sm, 0 2px 10px rgba(0,0,0,0.12))",
          opacity: busy ? 1 : progress,
          transform: `scale(${0.7 + progress * 0.3})`,
        }}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--foreground)" }} />
        ) : (
          <ArrowDown
            className="h-4 w-4 transition-transform duration-200"
            style={{
              color: ready ? "var(--foreground)" : "var(--muted-foreground)",
              transform: ready ? "rotate(180deg)" : undefined,
            }}
          />
        )}
      </div>
    </div>
  );
}
