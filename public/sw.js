// SayNoMore Service Worker — manual, no next-pwa
// Strategy: NetworkFirst (5s timeout) for Supabase API, stale-while-revalidate
// for static assets. Update model: a new SW skipWaiting()s and claims clients
// immediately; the page listens for controllerchange and reloads ONCE to the
// latest version automatically (no manual unregister, no stale JS after deploys).

const CACHE_VERSION = "snm-v6";
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

  // Next.js static chunks → stale-while-revalidate. Filenames are content-
  // hashed so a cache hit is safe, but SWR means the cache also refreshes in
  // the background — a stray stale chunk self-heals on the next load.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
    return;
  }

  // Fonts → stale-while-revalidate
  if (url.hostname === "fonts.gstatic.com" || url.hostname === "fonts.googleapis.com") {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
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

// Navigations: ask the network state, never infer it from a failure.
//
// ── THE BUG THIS REPLACES ───────────────────────────────────────────────────
//
// Ali, 2026-08-28, on 4G with full signal, opening Financials minutes after a
// deploy: **"You're offline"**. He was not. This handler treated every failed
// fetch as proof of a dead connection, and there are two ways to fail while
// perfectly connected:
//
//   1. AN 8-SECOND CAP, imposed here and nowhere else. /financials is
//      server-rendered; a cold serverless start on a Maldivian mobile
//      connection can pass 8 seconds, and the cap turned "slow" into "offline".
//   2. THE DEPLOY RELOAD. A new service worker claims the page, the app
//      reloads to pick it up, and the navigation already in flight is ABORTED.
//      An abort rejects exactly like a dead network.
//
// Telling a business owner he has no signal when he has four bars is worse than
// showing nothing: it sends him to check his phone instead of the app.
//
// ── WHAT IT DOES NOW ────────────────────────────────────────────────────────
//
// Offline (the browser says so): don't even try — go straight to a cached page
// or the shell. That is also FASTER than the old path, which sat for 8 seconds
// waiting for a network that was not there.
//
// Online: no artificial cap at all — the browser has its own — plus one retry,
// because the single most likely failure here is a one-off abort. Only if both
// attempts fail do we fall back, and the shell then works out its own wording
// from `navigator.onLine` rather than asserting something false.
async function navigationHandler(request) {
  const cache = await caches.open(STATIC_CACHE);

  if (navigator.onLine !== false) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      } catch {
        /* try once more, then fall through to the cache */
      }
    }
  }

  const cachedPage = await cache.match(request);
  if (cachedPage) return cachedPage;

  const offlineShell = await cache.match("/offline");
  if (offlineShell) return offlineShell;

  // Absolute last resort — inline HTML so Safari always shows *something*.
  // Deliberately says nothing about the connection: this is the one branch
  // that cannot run JavaScript to find out, so it must not guess.
  return new Response(
    "<!doctype html><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>" +
    "<title>SayNoMore</title><body style='font-family:-apple-system,system-ui,sans-serif;display:flex;" +
    "min-height:100vh;align-items:center;justify-content:center;margin:0;background:#000;color:#fff;text-align:center'>" +
    "<div style='padding:24px'><div style='font-size:40px'>📶</div><h1 style='font-size:20px'>That didn't load</h1>" +
    "<p style='color:#999;font-size:15px'>Pull down to try again. Anything you entered is saved and will sync.</p></div>",
    { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 200 }
  );
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

// Serve from cache immediately (fast), while fetching a fresh copy in the
// background to update the cache for next time. Best of both: instant loads
// AND self-healing when an asset changes.
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

// ─── Push Notifications ─────────────────────────────────────────────────────

self.addEventListener("push", (event) => {
  let data = { title: "SayNoMore", body: "" };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "snm-push",
      data: data.url ? { url: data.url } : undefined,
    })
  );
});

// A notification's `url` decides where tapping it takes you, and it arrives
// from outside this app. Never navigate anywhere but our own origin: an
// attacker who can trigger a push must not be able to land Ali on their page
// ("Payment failed, tap to re-enter your bank details") inside the installed
// app, where it looks like part of SayNoMore. Anything that isn't a plain
// in-app path is discarded and we just open the home screen.
function safeInAppPath(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "/";
  try {
    // Resolving against our origin turns "/sales" into a same-origin URL and
    // "https://evil.example" into a different one, so the check below catches
    // absolute URLs, protocol-relative "//evil.com", and "javascript:" alike.
    const resolved = new URL(raw, self.location.origin);
    if (resolved.origin !== self.location.origin) return "/";
    return resolved.pathname + resolved.search + resolved.hash;
  } catch {
    return "/";
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safeInAppPath(event.notification.data?.url);
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const match = list.find((c) => c.url.includes(self.location.origin) && "focus" in c);
      if (match) return match.focus().then((c) => c.navigate(url));
      return clients.openWindow(url);
    })
  );
});

// ─── Strategies ─────────────────────────────────────────────────────────────

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    fetch(request)
      .then((res) => { clearTimeout(timer); resolve(res); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}
