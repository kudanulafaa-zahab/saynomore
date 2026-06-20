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

      if (res.ok || res.status === 204) {
        await removeFromQueue(item.id!);
        synced++;
      } else {
        if (res.status >= 400 && res.status < 500) {
          await removeFromQueue(item.id!);
        }
        failed++;
      }
    } catch {
      failed++;
      break;
    }
  }

  return { synced, failed };
}
