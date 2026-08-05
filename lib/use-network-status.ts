"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { drainQueue, getPendingCount } from "./offline-queue";
import { supabase } from "./supabase";

export interface NetworkStatus {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  lastSyncedAt: Date | null;
  /** Set when the last drain couldn't apply something. Shown in the banner. */
  syncError: string | null;
  triggerSync: () => Promise<void>;
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function useNetworkStatus(): NetworkStatus {
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const refreshCount = useCallback(async () => {
    const count = await getPendingCount();
    setPendingCount(count);
  }, []);

  // Use a ref so the online handler always sees the latest isSyncing value
  // without needing to re-register the event listener on every state change.
  const isSyncingRef = useRef(false);

  const triggerSync = useCallback(async () => {
    if (isSyncingRef.current || !navigator.onLine) return;
    isSyncingRef.current = true;
    setIsSyncing(true);
    try {
      // The user's own JWT, never the anon key. Replaying as anon meant every
      // write was rejected by RLS (and then silently dropped) — see the
      // comment on drainQueue. No session = don't drain at all, so nothing
      // is lost while the token refreshes.
      const { data: { session } } = await supabase.auth.getSession();
      const { synced, error } = await drainQueue(
        SUPABASE_URL,
        SUPABASE_ANON_KEY,
        session?.access_token ?? null,
      );
      if (synced > 0) {
        setLastSyncedAt(new Date());
      }
      setSyncError(error);
      await refreshCount();
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [refreshCount]);

  useEffect(() => {
    // Initialise with actual browser state
    setIsOnline(navigator.onLine);
    refreshCount();

    const handleOnline = () => {
      setIsOnline(true);
      // Short delay so the connection is stable before draining
      setTimeout(() => triggerSync(), 1000);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Poll pending count every 30s while tab is open
    const interval = setInterval(refreshCount, 30_000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, [refreshCount, triggerSync]);

  return { isOnline, pendingCount, isSyncing, lastSyncedAt, syncError, triggerSync };
}
