"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

/**
 * The ONE modal/sheet surface for the whole app.
 *
 * Every screen used to hand-roll its own `fixed inset-0` overlay, which meant
 * the surface recipe (opacity, blur, scrim, entrance, safe-area, scroll-lock)
 * was copy-pasted 7+ times and drifted — some built on --glass-2 with no blur
 * and rendered see-through in dark mode (the Add Competitor bug). This is the
 * single source of truth: fix or restyle a modal HERE and the whole app follows.
 *
 * Surface is OPAQUE by design — `--popover` (near-solid: 94% dark / 96% light),
 * the token meant for floating panels, plus the heavy glass blur. Never build a
 * readable modal on a translucent content token again.
 *
 * Two shapes:
 *  - variant="docked"  full-height sheet docked to the bottom edge with a pinned
 *                      header/footer and ONE inner scroll region — for forms.
 *                      Pass `header` and `footer`; `children` is the scroll body.
 *  - variant="auto"    content-sized card, bottom on mobile / centered on desktop
 *                      — for compact dialogs and confirmations. `children` is the
 *                      whole body; header/footer are ignored.
 *
 * Tapping the scrim closes (set `dismissable={false}` to require an explicit
 * action). Swipe-down on the grabber also closes on mobile.
 */

const SCRIM: React.CSSProperties = {
  background: "var(--scrim-bg)",
  backdropFilter: "var(--scrim-blur)",
  WebkitBackdropFilter: "var(--scrim-blur)",
};

const SURFACE: React.CSSProperties = {
  background: "var(--popover)",
  backdropFilter: "var(--glass-blur-lg)",
  WebkitBackdropFilter: "var(--glass-blur-lg)",
  boxShadow: "var(--glass-shadow-lg)",
};

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  variant?: "docked" | "auto";
  /** Docked only: pinned above the scroll region (title etc). */
  header?: ReactNode;
  /** Docked only: pinned below the scroll region (actions). */
  footer?: ReactNode;
  /** Docked sheet height as a dvh fraction (default 85). */
  heightDvh?: number;
  /** Auto variant max width (Tailwind class, default max-w-md). */
  maxWidth?: string;
  /** When false, tapping the scrim / swiping down does nothing. */
  dismissable?: boolean;
  /** Stacking order (default 50). Raise for a sheet-over-sheet. */
  z?: number;
}

export function Sheet({
  open,
  onClose,
  children,
  variant = "auto",
  header,
  footer,
  heightDvh = 85,
  maxWidth = "max-w-md",
  dismissable = true,
  z = 50,
}: SheetProps) {
  const startY = useRef<number | null>(null);
  useBodyScrollLock(open);

  // Portalled to document.body: the app shell's content wrapper
  // (app/(app)/layout.tsx) carries a load-bearing `z-[1]` (needed so it
  // paints above the wallpaper's ::before gradient — removing it washes
  // every page out, see commit 29eedaf). Any fixed-position overlay nested
  // inside that wrapper is capped at that stacking context's ceiling and
  // can never out-rank the shell's own always-on-top Topbar/BottomNav,
  // no matter its own z-index — footers/headers get visually buried under
  // the floating nav. Portalling escapes the shell's stacking context
  // entirely instead of fighting it from inside, same fix already proven
  // for NewSaleSheet/price-explain/MixedCartonSheet. Gated on a state flag
  // flipped inside useEffect (not a bare typeof check) so createPortal
  // never runs before document.body exists during hydration.
  const [portalReady, setPortalReady] = useState(false);
  useEffect(() => { setPortalReady(true); }, []);

  if (!open || !portalReady) return null;

  const close = () => { if (dismissable) onClose(); };

  function onTouchStart(e: React.TouchEvent) { startY.current = e.touches[0].clientY; }
  function onTouchEnd(e: React.TouchEvent) {
    if (dismissable && startY.current !== null && e.changedTouches[0].clientY - startY.current > 60) onClose();
    startY.current = null;
  }

  if (variant === "docked") {
    return createPortal(
      <div
        className="fixed inset-0 flex items-end snm-scrim-in"
        style={{ ...SCRIM, zIndex: z, touchAction: "none" }}
        onClick={close}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full rounded-t-3xl flex flex-col snm-sheet-in"
          style={{
            ...SURFACE,
            height: `${heightDvh}dvh`,
            maxHeight: "calc(100dvh - env(safe-area-inset-top, 44px) - 8px)",
            touchAction: "none",
          }}
        >
          {/* Pinned header — grabber (a swipe-down dismiss zone) + caller header */}
          <div className="shrink-0 px-6 pt-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: "var(--glass-border)" }} />
            {header}
          </div>

          {/* The ONE scroll region */}
          <div
            className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-6 pb-4"
            style={{ touchAction: "pan-y" }}
          >
            {children}
          </div>

          {footer && (
            <div
              className="shrink-0 px-6 pt-3"
              style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 16px))", borderTop: "0.5px solid var(--glass-border-lo)" }}
            >
              {footer}
            </div>
          )}
        </div>
      </div>,
      document.body,
    );
  }

  // variant="auto" — compact content-sized card
  return createPortal(
    <div
      className="fixed inset-0 flex items-end sm:items-center justify-center p-4 snm-scrim-in"
      style={{ ...SCRIM, zIndex: z, paddingBottom: "max(16px, env(safe-area-inset-bottom, 16px))" }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className={`w-full ${maxWidth} rounded-3xl p-6 space-y-4 snm-sheet-in snm-modal-card`}
        style={{ ...SURFACE, border: "0.5px solid var(--glass-border-lo)" }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
