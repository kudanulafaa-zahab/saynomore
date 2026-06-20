"use client";

import { enqueue, type QueuedWrite } from "./offline-queue";

/**
 * Attempt a live Supabase write. If the network is down (fetch throws),
 * fall back to the offline queue so the operation syncs on reconnect.
 *
 * Returns { queued: true } when the write was deferred, { queued: false }
 * when it completed live so callers can show the right toast.
 */
export async function withOfflineFallback<T>(
  liveWrite: () => Promise<T>,
  queueEntry: Omit<QueuedWrite, "id" | "timestamp">,
): Promise<{ result: T | null; queued: boolean }> {
  if (!navigator.onLine) {
    await enqueue(queueEntry);
    return { result: null, queued: true };
  }
  try {
    const result = await liveWrite();
    return { result, queued: false };
  } catch (err) {
    // Only queue on network errors, not on Supabase validation errors
    const isNetworkError =
      err instanceof TypeError && err.message.toLowerCase().includes("fetch");
    if (isNetworkError) {
      await enqueue(queueEntry);
      return { result: null, queued: true };
    }
    throw err;
  }
}
