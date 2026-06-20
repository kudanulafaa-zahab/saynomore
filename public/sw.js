// SayNoMore Service Worker — manual, no next-pwa
// Strategy: NetworkFirst (5s timeout) for Supabase API, CacheFirst for static assets

const CACHE_VERSION = "snm-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SUPABASE_ORIGIN = self.location.hostname === "localhost"
  ? null
  : "supabase.co";

// Assets to precache on install
const PRECACHE_URLS = [
  "/",
  "/offline",
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

// ─── Activate ───────────────────────────────────────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("snm-") && k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET, browser-extension requests, and Next.js HMR
  if (
    request.method !== "GET" ||
    url.protocol === "chrome-extension:" ||
    url.pathname.startsWith("/_next/webpack-hmr")
  ) {
    return;
  }

  // Supabase REST API → NetworkFirst with 5 second timeout
  if (SUPABASE_ORIGIN && url.hostname.endsWith(SUPABASE_ORIGIN) && url.pathname.startsWith("/rest/v1/")) {
    event.respondWith(networkFirst(request, API_CACHE, 5000));
    return;
  }

  // Next.js static chunks → CacheFirst
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Fonts → CacheFirst
  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // App pages → NetworkFirst, fallback to cache
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, STATIC_CACHE, 8000));
    return;
  }
});

// ─── Strategies ─────────────────────────────────────────────────────────────

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);

  try {
    const networkResponse = await fetchWithTimeout(request, timeoutMs);
    if (networkResponse.ok) {
      // Only cache successful responses
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    // Network failed or timed out — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // If it's a navigation, serve the offline shell
    if (request.mode === "navigate") {
      const offlinePage = await cache.match("/offline");
      if (offlinePage) return offlinePage;
    }

    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return new Response("Offline", { status: 503 });
  }
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request)
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}
