"use client";

// Platform/context detection for the install tutorial. Kept in one place
// because the same signals (standalone? which OS? which in-app browser?)
// decide both whether to show anything at all and which walkthrough to show.

export function isStandalone(): boolean {
  if (typeof window === "undefined") return true; // never show during SSR
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari's own (non-standard, but real) flag
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as "Macintosh" but exposes touch points — the
  // documented way to tell it apart from a real Mac.
  const isIPadOS = ua.includes("Macintosh") && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || isIPadOS;
}

export function isAndroid(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent);
}

// Instagram/Facebook/TikTok/Messenger open links in their own embedded
// browser, which — on iOS specifically — does not expose Safari's Share menu
// the same way, so "Add to Home Screen" is unreliable or absent. The walk-
// through needs to tell people to open in Safari first, not show steps that
// silently don't work for anyone arriving from a social bio link.
export function isInAppBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /FBAN|FBAV|Instagram|Messenger|BytedanceWebview|TikTok|Line\//.test(ua);
}
