"use client";

import { useNetworkStatus } from "@/lib/use-network-status";
import { WifiOff, RefreshCw, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

export function OfflineBanner() {
  const { isOnline, pendingCount, isSyncing, lastSyncedAt, triggerSync } = useNetworkStatus();
  const [justSynced, setJustSynced] = useState(false);

  // Show "synced" flash for 3 seconds after sync completes
  useEffect(() => {
    if (!isSyncing && lastSyncedAt) {
      setJustSynced(true);
      const t = setTimeout(() => setJustSynced(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isSyncing, lastSyncedAt]);

  // Synced flash — only show briefly
  if (justSynced && isOnline && pendingCount === 0) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-2.5 ios-subhead font-medium transition-all"
        style={{
          background: "color-mix(in srgb, var(--snm-success) 12%, transparent)",
          color: "var(--snm-success)",
          borderBottom: "0.5px solid color-mix(in srgb, var(--snm-success) 20%, transparent)",
        }}
      >
        <CheckCircle2 size={15} />
        <span>All changes synced</span>
      </div>
    );
  }

  // Offline banner
  if (!isOnline) {
    return (
      <div
        className="flex items-center justify-between px-4 py-2.5 ios-subhead font-medium"
        style={{
          background: "color-mix(in srgb, var(--snm-warning) 12%, transparent)",
          color: "var(--snm-warning)",
          borderBottom: "0.5px solid color-mix(in srgb, var(--snm-warning) 20%, transparent)",
        }}
      >
        <div className="flex items-center gap-2">
          <WifiOff size={15} />
          <span>
            Offline
            {pendingCount > 0 && (
              <> — <strong>{pendingCount}</strong> {pendingCount === 1 ? "change" : "changes"} pending sync</>
            )}
          </span>
        </div>
      </div>
    );
  }

  // Online but has pending queue (came back online, still draining)
  if (isOnline && pendingCount > 0) {
    return (
      <div
        className="flex items-center justify-between px-4 py-2.5 ios-subhead font-medium"
        style={{
          background: "color-mix(in srgb, var(--snm-brand) 10%, transparent)",
          color: "var(--snm-brand-text)",
          borderBottom: "0.5px solid color-mix(in srgb, var(--snm-brand) 15%, transparent)",
        }}
      >
        <div className="flex items-center gap-2">
          <RefreshCw size={15} className={isSyncing ? "animate-spin" : ""} />
          <span>
            {isSyncing
              ? "Syncing changes…"
              : `${pendingCount} ${pendingCount === 1 ? "change" : "changes"} waiting to sync`}
          </span>
        </div>
        {!isSyncing && (
          <button
            onClick={triggerSync}
            className="snm-pressable ios-subhead px-3 py-1 rounded-lg font-semibold"
            style={{
              background: "color-mix(in srgb, var(--snm-brand) 15%, transparent)",
              color: "var(--snm-brand-text)",
            }}
          >
            Sync now
          </button>
        )}
      </div>
    );
  }

  return null;
}
