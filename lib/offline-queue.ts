import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "saynomore-offline";
const DB_VERSION = 1;
const STORE = "pending_writes";

export interface QueuedWrite {
  id?: number;
  table: string;
  action: "insert" | "update" | "delete" | "rpc";
  payload: Record<string, unknown>;
  match?: Record<string, unknown>; // for update/delete: the .eq() filter
  rpcName?: string;               // for rpc calls
  timestamp: number;
  tempId?: string;                // local UUID for optimistic records
}

let _db: IDBPDatabase | null = null;

async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      }
    },
  });
  return _db;
}

export async function enqueue(write: Omit<QueuedWrite, "id" | "timestamp">): Promise<void> {
  const db = await getDb();
  await db.add(STORE, { ...write, timestamp: Date.now() });
}

export async function getPendingCount(): Promise<number> {
  const db = await getDb();
  return db.count(STORE);
}

export async function getPending(): Promise<QueuedWrite[]> {
  const db = await getDb();
  return db.getAll(STORE);
}

export async function removeFromQueue(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

export async function clearQueue(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE);
}

// Drain: replays every queued write against Supabase in order.
// Returns number of successfully synced items.
export async function drainQueue(
  supabaseUrl: string,
  supabaseKey: string,
): Promise<{ synced: number; failed: number }> {
  const pending = await getPending();
  if (pending.length === 0) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const item of pending) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Prefer": "return=minimal",
      };

      let url = `${supabaseUrl}/rest/v1/${item.table}`;
      let method = "POST";

      if (item.action === "insert") {
        method = "POST";
      } else if (item.action === "update" && item.match) {
        method = "PATCH";
        const params = new URLSearchParams(
          Object.entries(item.match).map(([k, v]) => [`${k}`, `eq.${v}`])
        );
        url += `?${params}`;
      } else if (item.action === "delete" && item.match) {
        method = "DELETE";
        const params = new URLSearchParams(
          Object.entries(item.match).map(([k, v]) => [`${k}`, `eq.${v}`])
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

      if (res.ok || res.status === 204) {
        await removeFromQueue(item.id!);
        synced++;
      } else {
        // Non-retriable errors (e.g. 400 bad request): drop to avoid infinite queue
        const body = await res.text();
        console.error(`[offline-queue] Failed to sync item ${item.id}:`, res.status, body);
        if (res.status >= 400 && res.status < 500) {
          await removeFromQueue(item.id!);
        }
        failed++;
      }
    } catch {
      // Network still down — stop draining
      failed++;
      break;
    }
  }

  return { synced, failed };
}
