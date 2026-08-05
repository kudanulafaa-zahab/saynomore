"use client";

// Pull-to-refresh that rides iOS's own rubber-band instead of replacing it.
//
// The usual web implementation calls preventDefault on touchmove and animates
// its own translate. That would break this app's standing rule that the iOS
// bounce stays on — the bounce is the native signature, and a commit once
// killed it with `overscroll-behavior: none` and made the app feel dead.
//
// So: no preventDefault anywhere in this file. Every listener is passive.
// iOS reports a NEGATIVE document scrollTop while you are rubber-banding past
// the top, so the pull distance can simply be read off the scroll position
// the browser is already animating. The gesture is the native bounce; we only
// measure it. On engines that clamp scrollTop at 0 (Android Chrome) we fall
// back to raw touch delta while pinned at the top, which is still passive.
//
// Screens opt in with useRefreshHandler(load). Anything that doesn't opt in
// simply bounces as before.

import { useEffect } from "react";

/** Distance in px the user must pull past the top before it arms. Apple's own
 *  apps sit around 60-80; below ~55 it fires on an ordinary scroll flick. */
export const PULL_THRESHOLD = 72;

type Handler = () => Promise<unknown> | unknown;

const handlers = new Set<Handler>();

/** Registers this screen's reload function for the pull gesture. */
export function useRefreshHandler(fn: Handler) {
  useEffect(() => {
    handlers.add(fn);
    return () => { handlers.delete(fn); };
  }, [fn]);
}

export async function runRefreshHandlers() {
  // Settle, not all: one screen's failed reload shouldn't leave the spinner
  // stuck for the others.
  await Promise.allSettled([...handlers].map((h) => h()));
}

export function documentScrollTop() {
  return window.scrollY || document.documentElement.scrollTop || 0;
}
