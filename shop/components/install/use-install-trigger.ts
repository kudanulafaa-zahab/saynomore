"use client";

import { useCallback, useState } from "react";
import { isStandalone } from "@/lib/install-detect";

// "Shown at most once per session per trigger point" (first add-to-cart,
// order confirmation) — sessionStorage, not localStorage, so a shopper who
// dismissed it yesterday still sees it again on a fresh visit today.
export function useInstallTrigger(key: string) {
  const [open, setOpen] = useState(false);

  const fire = useCallback(() => {
    if (isStandalone()) return; // already installed — nothing to offer
    const storageKey = `snm-shop-install-shown-${key}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      /* storage blocked — fall through and show anyway for this page view */
    }
    setOpen(true);
  }, [key]);

  const close = useCallback(() => setOpen(false), []);

  return { open, fire, close };
}
