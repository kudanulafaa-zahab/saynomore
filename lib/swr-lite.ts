"use client";

/**
 * Tiny stale-while-revalidate cache for the hot list queries every screen
 * loads on mount (SKU catalogue, godowns, customers, stock). Screens keep
 * their exact `useEffect(load)` shape — this sits UNDER lib/queries so every
 * caller benefits without touching components:
 *
 * - Fresh hit (< ttl): resolves instantly from memory → screen paints with
 *   zero network wait, the "native app" switch feel.
 * - Stale hit: resolves instantly with the stale value AND refetches in the
 *   background so the NEXT read is fresh. A screen the user sits on for a
 *   while self-heals on its next visit.
 * - Miss: fetches normally.
 *
 * PERSISTENCE (added 2026-07): the in-memory Map is wiped on every cold open,
 * reload, or PWA relaunch — the exact moments the app felt slowest, because
 * every screen then waited on the network from scratch. So entries whose data
 * rarely changes (long TTL — catalogue, godowns, customers) are also written
 * to localStorage. On the next cold open they seed the cache instantly (served
 * as stale → painted immediately, revalidated in the background), so the app
 * opens showing real content and refreshes underneath. Short-TTL volatile data
 * (stock, 30s) stays memory-only so on-hand numbers are never read off disk.
 *
 * Mutations that change stock/prices call invalidate() so a post-save load()
 * in the same screen always refetches for real — money and stock numbers are
 * never served stale after the user's own action.
 */

interface Entry {
  data: unknown;
  ts: number;
  inflight: Promise<unknown> | null;
}

const cache = new Map<string, Entry>();

// Only data with a TTL at or above this threshold is persisted to disk — that
// captures the rarely-changing masters (catalogue/godowns/customers at 5 min)
// and deliberately excludes volatile stock (30 s), which stays memory-only.
const PERSIST_MIN_TTL = 120_000;
const STORE_PREFIX = "snm-swr:v1:";
const hasLS = typeof window !== "undefined" && (() => {
  try { const k = "__snm_ls__"; window.localStorage.setItem(k, "1"); window.localStorage.removeItem(k); return true; }
  catch { return false; }
})();

function readPersisted(key: string): Entry | null {
  if (!hasLS) return null;
  try {
    const raw = window.localStorage.getItem(STORE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data: unknown; ts: number };
    if (!parsed || typeof parsed.ts !== "number") return null;
    return { data: parsed.data, ts: parsed.ts, inflight: null };
  } catch { return null; }
}

function writePersisted(key: string, data: unknown, ts: number, ttlMs: number) {
  if (!hasLS || ttlMs < PERSIST_MIN_TTL) return;
  try {
    window.localStorage.setItem(STORE_PREFIX + key, JSON.stringify({ data, ts }));
  } catch {
    // Quota exceeded — clear our own namespace and give up quietly; the cache
    // still works in memory. Never let a storage error break a data load.
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (k && k.startsWith(STORE_PREFIX)) window.localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  }
}

export function swrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  let hit = cache.get(key);

  // Cold in-memory miss but we have a disk copy from a previous session — seed
  // the cache with it so this very first read after opening the app paints
  // instantly instead of waiting on the network.
  if (!hit) {
    const persisted = readPersisted(key);
    if (persisted) { cache.set(key, persisted); hit = persisted; }
  }

  const store = (data: T) => {
    cache.set(key, { data, ts: Date.now(), inflight: null });
    writePersisted(key, data, Date.now(), ttlMs);
    return data;
  };

  if (hit && hit.ts !== 0 && now - hit.ts < ttlMs) {
    return Promise.resolve(hit.data as T); // fresh — instant
  }

  if (hit) {
    // First load still in flight (placeholder entry) — join it, never hand
    // back the undefined placeholder.
    if (hit.ts === 0 && hit.inflight) return hit.inflight as Promise<T>;
    // Stale (in memory or seeded from disk) — serve instantly, revalidate
    // behind the scenes (dedup inflight).
    if (!hit.inflight) {
      const h = hit;
      h.inflight = fetcher()
        .then((data) => store(data))
        .catch((e) => { h.inflight = null; throw e; });
      h.inflight.catch(() => {}); // background failure keeps stale value
    }
    return Promise.resolve(hit.data as T);
  }

  // True miss — fetch and store (dedup concurrent first loads)
  const p = fetcher().then((data) => store(data));
  cache.set(key, { data: undefined, ts: 0, inflight: p as Promise<unknown> });
  return p.finally(() => {
    const e = cache.get(key);
    if (e && e.inflight === p) e.inflight = null;
  }) as Promise<T>;
}

/** Drop every cached entry whose key starts with one of the prefixes — memory
 *  AND disk. Call from mutation paths so the caller's own refresh refetches for
 *  real. */
export function invalidate(...prefixes: string[]) {
  for (const key of cache.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
  }
  if (hasLS) {
    try {
      for (let i = window.localStorage.length - 1; i >= 0; i--) {
        const k = window.localStorage.key(i);
        if (!k || !k.startsWith(STORE_PREFIX)) continue;
        const bare = k.slice(STORE_PREFIX.length);
        if (prefixes.some((p) => bare.startsWith(p))) window.localStorage.removeItem(k);
      }
    } catch { /* ignore */ }
  }
}
