"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, X } from "lucide-react";
import { subscribeToPush } from "@/lib/push";
import { haptic } from "@/lib/haptics";

const NUDGE_KEY = "snm-notif-nudge-dismissed";

// "On by default", the honest iOS version: Apple requires ONE tap from the
// user, once per device — notifications can never be enabled silently. So:
//  - permission already granted → silently (re)subscribe on every app open,
//    keeping the push_subscriptions row fresh forever with zero taps.
//  - permission not asked yet → a one-time dismissible card with a single
//    "Turn on" tap (the tap itself is the permission gesture iOS requires).
//  - dismissed or denied → never nag again; Settings remains the home.
export function NotificationsBootstrap() {
  const [showNudge, setShowNudge] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    if (
      !("Notification" in window) ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      return;
    }
    if (Notification.permission === "granted") {
      // Self-healing: reuses the existing browser subscription and upserts the
      // row, so a cleared DB row or fresh login never silently kills pushes.
      subscribeToPush().catch(() => {});
      return;
    }
    if (Notification.permission === "default" && !localStorage.getItem(NUDGE_KEY)) {
      // Permission never asked → there can be no push subscription yet, so no
      // need to await serviceWorker.ready. Small delay so the page settles
      // before the card slides in.
      const t = setTimeout(() => setShowNudge(true), 400);
      return () => clearTimeout(t);
    }
  }, []);

  if (!showNudge) return null;

  async function enable() {
    setEnabling(true);
    try {
      const r = await subscribeToPush();
      if (r.ok) {
        haptic("success");
        toast.success("Notifications are on");
        setShowNudge(false);
        try { localStorage.setItem(NUDGE_KEY, "1"); } catch { /* session-only */ }
      } else {
        haptic("error");
        toast.error(r.reason ?? "Could not enable notifications");
        // Denied or unsupported — stop asking; Settings explains the fix.
        setShowNudge(false);
        try { localStorage.setItem(NUDGE_KEY, "1"); } catch { /* session-only */ }
      }
    } finally {
      setEnabling(false);
    }
  }

  function dismiss() {
    setShowNudge(false);
    try { localStorage.setItem(NUDGE_KEY, "1"); } catch { /* session-only */ }
  }

  return (
    <div
      className="mb-4 rounded-2xl px-4 py-3 flex items-center gap-3"
      style={{
        background: "var(--glass-1)",
        border: "0.5px solid var(--glass-border-lo)",
        boxShadow: "var(--glass-shadow), var(--glass-inner)",
      }}
    >
      <span
        className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: "color-mix(in srgb, var(--foreground) 10%, transparent)", color: "var(--foreground)" }}
      >
        <Bell className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="ios-subhead font-semibold" style={{ color: "var(--foreground)" }}>
          Turn on notifications
        </p>
        <p className="ios-footnote" style={{ color: "var(--muted-foreground)" }}>
          Delivery and money alerts, even when the app is closed
        </p>
      </div>
      <button
        onClick={enable}
        disabled={enabling}
        className="px-3.5 py-2 rounded-xl ios-subhead font-semibold shrink-0 transition active:scale-95 disabled:opacity-50"
        style={{ background: "var(--foreground)", color: "var(--background)" }}
      >
        Turn on
      </button>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        className="h-8 w-8 -mr-1 flex items-center justify-center rounded-lg shrink-0 transition active:scale-95"
        style={{ color: "var(--muted-foreground)" }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
