"use client";

const DB_NAME = "saynomore-offline";
const DB_VERSION = 1;
const STORE = "pending_writes";

export interface QueuedWrite {
  id?: number;
  table: string;
  action: "insert" | "update" | "delete" | "rpc";
  payload: Record<string, unknown>;
  match?: Record<string, unknown>;
  rpcName?: string;
  timestamp: number;
  tempId?: string;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(write: Omit<QueuedWrite, "id" | "timestamp">): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add({ ...write, timestamp: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getPendingCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getPending(): Promise<QueuedWrite[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as QueuedWrite[]);
    req.onerror = () => reject(req.error);
  });
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export interface DrainResult {
  synced: number;
  /** Entries still queued because they could not be applied. Never discarded. */
  failed: number;
  /** True when the queue was not attempted at all (no signed-in session). */
  blocked: boolean;
  /** Plain-English reason for the first failure, for the banner. */
  error: string | null;
}

/**
 * Replay queued writes against Supabase.
 *
 * `accessToken` MUST be the signed-in user's JWT, not the anon key. This
 * used to pass the anon key as the Bearer token, which was silently
 * destroying every offline write:
 *   - every RLS policy on sales_orders/expenses requires is_admin_or_manager(),
 *     which is false for anon, so INSERTs came back 4xx — and the old code
 *     deleted 4xx entries from the queue and moved on;
 *   - PATCHes matched zero rows under RLS and returned 204 No Content, which
 *     the old code counted as SUCCESS and removed.
 * Net effect: a driver could record MVR 8,000 of collected cash in a dead
 * zone, see "Saved offline", later see "All changes synced", and nothing
 * ever reached the database. Verified against the live schema: anon holds
 * table-level INSERT/UPDATE on sales_orders, gated only by RLS, so the
 * requests really did reach Postgres and really were filtered to nothing.
 *
 * Rules now: never drain without a real session; never delete an entry that
 * did not verifiably apply; stop at the first failure so a later write can
 * never overtake the earlier write it depends on.
 */
export async function drainQueue(
  supabaseUrl: string,
  supabaseAnonKey: string,
  accessToken: string | null,
): Promise<DrainResult> {
  const pending = await getPending();
  if (pending.length === 0) return { synced: 0, failed: 0, blocked: false, error: null };

  if (!accessToken) {
    return {
      synced: 0,
      failed: pending.length,
      blocked: true,
      error: "Not signed in — changes are safe and will sync once you sign in.",
    };
  }

  let synced = 0;
  let error: string | null = null;

  for (const item of pending) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "apikey": supabaseAnonKey,
        "Authorization": `Bearer ${accessToken}`,
        // representation, not minimal: for an UPDATE we must be able to see
        // whether any row actually matched. A 204 tells us nothing.
        "Prefer": "return=representation",
      };

      let url = `${supabaseUrl}/rest/v1/${item.table}`;
      let method = "POST";

      if (item.action === "update" && item.match) {
        method = "PATCH";
        const params = new URLSearchParams(
          Object.entries(item.match).map(([k, v]) => [k, `eq.${v}`])
        );
        url += `?${params}`;
      } else if (item.action === "delete" && item.match) {
        method = "DELETE";
        const params = new URLSearchParams(
          Object.entries(item.match).map(([k, v]) => [k, `eq.${v}`])
        );
        url += `?${params}`;
      } else if (item.action === "rpc" && item.rpcName) {
        url = `${supabaseUrl}/rest/v1/rpc/${item.rpcName}`;
        method = "POST";
      }

      const res = await fetch(url, {
        method,
        headers,
        body: method !== "DELETE" ? JSON.stringify(item.payload) : undefined,
      });

      if (!res.ok) {
        // Keep the entry. A write we cannot apply is a write the user still
        // needs to know about — dropping it is how money silently disappears.
        error = `Could not sync a saved change (${res.status}). It is still queued.`;
        break;
      }

      // An UPDATE that matched nothing is a failure wearing a success code:
      // the row was filtered by RLS, or the id no longer exists.
      if (method === "PATCH") {
        const rows = await res.json().catch(() => null);
        if (!Array.isArray(rows) || rows.length === 0) {
          error = "A saved change did not apply to any record. It is still queued.";
          break;
        }
      }

      await removeFromQueue(item.id!);
      synced++;
    } catch {
      error = "Connection lost while syncing. Remaining changes are still queued.";
      break;
    }
  }

  const stillPending = await getPendingCount();
  return { synced, failed: stillPending, blocked: false, error };
}
