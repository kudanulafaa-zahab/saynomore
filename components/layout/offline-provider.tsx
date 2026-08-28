"use client";

import { useEffect } from "react";
import { useKeyboardInset } from "@/lib/use-keyboard-inset";

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  // Publish the on-screen keyboard height as --kb-inset app-wide so any bottom
  // sheet can lift its action button above the keyboard. Cheap; 0 when closed.
  useKeyboardInset(true);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Auto-reload once when a new service worker takes control, so a deploy
    // never leaves the tab running stale JS. Guards:
    //  - only fires when there was ALREADY a controller (an update, not the
    //    first-ever install — first install shouldn't reload the page).
    //  - a one-shot flag prevents any reload loop.
    let reloading = false;
    const hadController = !!navigator.serviceWorker.controller;

    const onControllerChange = () => {
      if (reloading || !hadController) return;
      reloading = true;
      // NEVER RELOAD OUT FROM UNDER A NAVIGATION THAT IS STILL IN FLIGHT. A
      // reload aborts it, and an aborted request rejects exactly like a dead
      // network — which is how a deploy showed Ali "You're offline" on 4G with
      // full signal (2026-08-28). The service worker no longer draws that
      // conclusion, and this no longer creates the situation.
      if (document.readyState === "complete") window.location.reload();
      else window.addEventListener("load", () => window.location.reload(), { once: true });
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then((reg) => {
        console.log("[SW] Registered:", reg.scope);
        // Proactively check for a new version on load (and let the browser's
        // own periodic checks handle the rest). skipWaiting() in the SW means
        // a found update activates immediately → controllerchange → reload.
        reg.update().catch(() => {});
      })
      .catch((err) => {
        console.warn("[SW] Registration failed:", err);
      });

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return <>{children}</>;
}
