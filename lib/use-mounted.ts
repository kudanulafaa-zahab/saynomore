"use client";

import { useSyncExternalStore } from "react";

// Nothing external to subscribe to — the value never changes after hydration.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * True once mounted on the client, false during SSR/hydration.
 *
 * This is the sanctioned mounted-flag pattern (skills.md: "Mounted flags via
 * useSyncExternalStore"). It replaces `useState(false)` +
 * `useEffect(() => setMounted(true), [])`, which sets state synchronously inside
 * an effect and therefore costs an extra render pass on every mount. Behaviour is
 * identical: false on the server, true on the client after hydration.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
