// SayNoMore Service Worker — manual, no next-pwa
// Strategy: NetworkFirst (5s timeout) for Supabase API, CacheFirst for static assets

const CACHE_VERSION = "snm-v2";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SUPABASE_ORIGIN = self.location.hostname === "localhost"
  ? null
  : "supabase.co";

// Assets to precache on install. /offline is the offline shell — it is a
// public (non-auth) route so it caches cleanly and can always be served when
// a navigation fails offline.
const PRECACHE_URLS = [
  "/offline",
];

// ─── Install ────────────────────────────────────────────────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      // Cache each URL individually so one failure never aborts the whole
      // install (addAll is atomic — a single redirect/404 would wipe it out).
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { redirect: "follow" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* ignore — offline shell will be cached on first successful load */
          }
        })
      );
    }).then(() => self.skipWaiting())
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

  // App navigations (HTML pages) → NetworkFirst; if offline and nothing is
  // cached, always serve the offline shell so the browser never shows its own
  // "can't open the page" error.
  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  // Other same-origin GETs → NetworkFirst, fallback to cache
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, STATIC_CACHE, 8000));
    return;
  }
});

// Navigation requests get special treatment: try network, fall back to a
// cached copy of the page, then to the offline shell, and only as a last
// resort a minimal inline HTML page (never a bare 503 string).
async function navigationHandler(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetchWithTimeout(request, 8000);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch {
    const cachedPage = await cache.match(request);
    if (cachedPage) return cachedPage;

    const offlineShell = await cache.match("/offline");
    if (offlineShell) return offlineShell;

    // Absolute last resort — inline HTML so Safari always shows *something*.
    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>Offline</title><body style='font-family:-apple-system,system-ui,sans-serif;display:flex;" +
      "min-height:100vh;align-items:center;justify-content:center;margin:0;background:#000;color:#fff;text-align:center'>" +
      "<div style='padding:24px'><div style='font-size:40px'>📶</div><h1 style='font-size:20px'>You're offline</h1>" +
      "<p style='color:#999;font-size:15px'>Reconnect to load SayNoMore. Your saved changes will sync automatically.</p></div>",
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 }
    );
  }
}

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
