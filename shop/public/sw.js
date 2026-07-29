// SayNoMore Shop Service Worker — manual, no next-pwa.
// Strategy: NetworkFirst (5s timeout) for Supabase API, stale-while-revalidate
// for static assets. No push notifications — that's Phase 2, and needs
// Home Screen install first on iOS anyway. Adapted from the staff app's sw.js.

const CACHE_VERSION = "snm-shop-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const SUPABASE_ORIGIN = self.location.hostname === "localhost" ? null : "supabase.co";

const PRECACHE_URLS = ["/offline"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map(async (url) => {
          try {
            const res = await fetch(url, { redirect: "follow" });
            if (res.ok) await cache.put(url, res.clone());
          } catch {
            /* offline shell will be cached on first successful load */
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("snm-shop-") && k !== STATIC_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.protocol === "chrome-extension:" ||
    url.pathname.startsWith("/_next/webpack-hmr")
  ) {
    return;
  }

  if (SUPABASE_ORIGIN && url.hostname.endsWith(SUPABASE_ORIGIN) && url.pathname.startsWith("/rest/v1/")) {
    event.respondWith(networkFirst(request, API_CACHE, 5000));
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationHandler(request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request, STATIC_CACHE, 8000));
    return;
  }
});

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

    return new Response(
      "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
      "<title>Offline</title><body style='font-family:-apple-system,system-ui,sans-serif;display:flex;" +
      "min-height:100vh;align-items:center;justify-content:center;margin:0;background:#000;color:#fff;text-align:center'>" +
      "<div style='padding:24px'><div style='font-size:40px'>📶</div><h1 style='font-size:20px'>You're offline</h1>" +
      "<p style='color:#999;font-size:15px'>Reconnect to browse the shop. Your cart is saved on this device.</p></div>",
      { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 }
    );
  }
}

async function networkFirst(request, cacheName, timeoutMs) {
  const cache = await caches.open(cacheName);
  try {
    const networkResponse = await fetchWithTimeout(request, timeoutMs);
    if (networkResponse.ok) cache.put(request, networkResponse.clone());
    return networkResponse;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const offlinePage = await cache.match("/offline");
      if (offlinePage) return offlinePage;
    }
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response("Offline", { status: 503 });
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request)
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}
