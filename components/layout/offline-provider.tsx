"use client";

import { useEffect } from "react";

export function OfflineProvider({ children }: { children: React.ReactNode }) {
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
      window.location.reload();
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
