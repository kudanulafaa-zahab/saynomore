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

export function swrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && now - hit.ts < ttlMs) {
    return Promise.resolve(hit.data as T); // fresh — instant
  }

  if (hit) {
    // First load still in flight (placeholder entry) — join it, never hand
    // back the undefined placeholder.
    if (hit.ts === 0 && hit.inflight) return hit.inflight as Promise<T>;
    // Stale — serve instantly, revalidate behind the scenes (dedup inflight)
    if (!hit.inflight) {
      hit.inflight = fetcher()
        .then((data) => { cache.set(key, { data, ts: Date.now(), inflight: null }); return data; })
        .catch((e) => { hit.inflight = null; throw e; });
      hit.inflight.catch(() => {}); // background failure keeps stale value
    }
    return Promise.resolve(hit.data as T);
  }

  // Miss — fetch and store (dedup concurrent first loads)
  const p = fetcher().then((data) => {
    cache.set(key, { data, ts: Date.now(), inflight: null });
    return data;
  });
  cache.set(key, { data: undefined, ts: 0, inflight: p as Promise<unknown> });
  return p.finally(() => {
    const e = cache.get(key);
    if (e && e.inflight === p) e.inflight = null;
  }) as Promise<T>;
}

/** Drop every cached entry whose key starts with one of the prefixes.
 *  Call from mutation paths so the caller's own refresh refetches for real. */
export function invalidate(...prefixes: string[]) {
  for (const key of cache.keys()) {
    if (prefixes.some((p) => key.startsWith(p))) cache.delete(key);
  }
}
