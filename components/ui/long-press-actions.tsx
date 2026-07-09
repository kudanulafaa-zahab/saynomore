"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Trash2, Ban, X } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

// Press-and-hold to reveal row actions (Delete / Void). Chosen over
// swipe-to-reveal because horizontal swipe fights iOS Safari's own
// scroll/back gestures inside a vertically-scrolling PWA list — the swipe
// version got stuck half-open on real devices. A long-press has no axis to
// conflict with: hold still ~450ms and a native-style action sheet slides up.
//
// A normal tap still does the row's own thing (navigate) — the press only
// becomes a "hold" after the timer fires, and any finger movement before
// then cancels it (that movement is a scroll, not a hold).

export type RowAction = {
  label: string;
  kind: "destructive" | "warning" | "default";
  onSelect: () => void;
};

const HOLD_MS = 450;
const MOVE_CANCEL_PX = 10;

export function LongPressActions({
  actions,
  menuTitle,
  children,
}: {
  actions: RowAction[];
  menuTitle: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    start.current = null;
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    // Only primary button / touch — ignore right-click etc.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    fired.current = false;
    start.current = { x: e.clientX, y: e.clientY };
    timer.current = setTimeout(() => {
      fired.current = true;
      haptic("warning");
      setOpen(true);
    }, HOLD_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!start.current) return;
    const dx = Math.abs(e.clientX - start.current.x);
    const dy = Math.abs(e.clientY - start.current.y);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clear(); // it's a scroll, not a hold
  }

  return (
    <>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={clear}
        onPointerCancel={clear}
        onPointerLeave={clear}
        onContextMenu={(e) => e.preventDefault()} // suppress the OS long-press context menu
        // If the hold fired, swallow the click that follows so the row's
        // own onClick/Link never also navigates on release.
        onClickCapture={(e) => { if (fired.current) { e.preventDefault(); e.stopPropagation(); fired.current = false; } }}
        style={{ touchAction: "pan-y" }}
      >
        {children}
      </div>

      {open && <ActionSheet title={menuTitle} actions={actions} onClose={() => setOpen(false)} />}
    </>
  );
}

function ActionSheet({
  title, actions, onClose,
}: {
  title: string;
  actions: RowAction[];
  onClose: () => void;
}) {
  useBodyScrollLock(true);
  const startY = useRef<number | null>(null);
  // Portal target gated on a mount flag (not an inline typeof check, which
  // can race during React's render pass — that exact inline pattern crashed
  // the New Sale price sheet before). Flipped true only after client mount.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  const sheet = (
    <>
      <div
        className="fixed inset-0 z-[200]"
        style={{ background: "rgba(0,0,0,0.50)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)" }}
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-[201]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}
        onTouchStart={(e) => { startY.current = e.touches[0].clientY; }}
        onTouchEnd={(e) => { if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 60) onClose(); startY.current = null; }}
      >
        <div
          className="mx-2 mb-2 rounded-3xl overflow-hidden"
          style={{ background: "var(--glass-bg-1)", backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)", boxShadow: "var(--glass-shadow-lg)" }}
        >
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-[3px] rounded-full" style={{ background: "var(--muted-foreground)", opacity: 0.3 }} />
          </div>
          <p className="text-center ios-subhead font-semibold px-5 pt-2 pb-3" style={{ color: "var(--muted-foreground)" }}>
            {title}
          </p>
          <div className="px-3 pb-3 space-y-2">
            {actions.map((a) => {
              const color = a.kind === "destructive" ? "var(--snm-error)" : a.kind === "warning" ? "var(--snm-warning)" : "var(--foreground)";
              const Icon = a.kind === "destructive" ? Trash2 : a.kind === "warning" ? Ban : null;
              return (
                <button
                  key={a.label}
                  onClick={() => { a.onSelect(); onClose(); }}
                  className="w-full h-14 rounded-2xl flex items-center justify-center gap-2 ios-subhead font-semibold transition active:scale-[0.98]"
                  style={{
                    background: a.kind === "default" ? "var(--glass-bg-2)" : `color-mix(in srgb, ${color} 12%, transparent)`,
                    color,
                    border: "0.5px solid var(--glass-border-lo)",
                  }}
                >
                  {Icon && <Icon className="h-4 w-4" />}
                  {a.label}
                </button>
              );
            })}
            <button
              onClick={onClose}
              className="w-full h-14 rounded-2xl flex items-center justify-center gap-2 ios-subhead font-semibold transition active:scale-[0.98]"
              style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
            >
              <X className="h-4 w-4" /> Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );

  // Portal to body — the sheet is a full-screen layer, never a descendant of
  // a transformed/positioned list row (same reasoning as the app's other
  // sheets), so it can never be clipped by an ancestor's overflow.
  return portalReady ? createPortal(sheet, document.body) : null;
}
