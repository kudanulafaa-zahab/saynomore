"use client";

import { useRef } from "react";
import { AlertTriangle } from "lucide-react";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";

interface ConfirmSheetProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel?: string;
  loading?: boolean;
}

export function ConfirmSheet({
  open, onClose, onConfirm, title, message, confirmLabel = "Delete", loading = false,
}: ConfirmSheetProps) {
  const startY = useRef<number | null>(null);

  useBodyScrollLock(open);

  function onTouchStart(e: React.TouchEvent) { startY.current = e.touches[0].clientY; }
  function onTouchEnd(e: React.TouchEvent) {
    if (startY.current !== null && e.changedTouches[0].clientY - startY.current > 60) onClose();
    startY.current = null;
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] snm-scrim-in"
        style={{ background: "var(--scrim-bg)", backdropFilter: "var(--scrim-blur)", WebkitBackdropFilter: "var(--scrim-blur)" }}
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed bottom-0 left-0 right-0 z-[201] snm-sheet-in"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 12px)" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="mx-2 mb-2 rounded-3xl overflow-hidden"
          style={{ background: "var(--glass-bg-2)", backdropFilter: "var(--glass-blur-lg)", WebkitBackdropFilter: "var(--glass-blur-lg)", boxShadow: "var(--glass-shadow-lg)" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="w-9 h-[3px] rounded-full" style={{ background: "var(--muted-foreground)", opacity: 0.30 }} />
          </div>

          <div className="px-5 pt-3 pb-6 space-y-4">
            {/* Icon + title */}
            <div className="flex items-center gap-3">
              <div
                className="h-10 w-10 rounded-2xl flex items-center justify-center shrink-0"
                style={{ background: "color-mix(in srgb, var(--snm-error) 15%, transparent)" }}
              >
                <AlertTriangle className="h-5 w-5" style={{ color: "var(--snm-error)" }} />
              </div>
              <div>
                <p className="text-[15px] font-semibold" style={{ color: "var(--foreground)" }}>{title}</p>
                <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>{message}</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2.5">
              <button
                onClick={onClose}
                disabled={loading}
                className="flex-1 rounded-2xl py-3.5 text-[14px] font-semibold transition-all active:scale-[0.97]"
                style={{ background: "var(--glass-bg-2)", color: "var(--foreground)", border: "0.5px solid var(--glass-border-lo)" }}
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className="flex-1 rounded-2xl py-3.5 text-[14px] font-semibold transition-all active:scale-[0.97]"
                style={{ background: "var(--snm-error)", color: "var(--snm-on-fill)", opacity: loading ? 0.6 : 1 }}
              >
                {loading ? "Deleting…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
