// Minimal service worker — exists to satisfy PWA installability (a fetch handler is part of
// the criteria) and to speed up repeat loads of immutable, content-hashed build assets.
// Deliberately does NOT cache API responses or HTML documents: this app shows live business
// data (catalogues, valuations, market intelligence) — a cached stale response here would be
// actively wrong, not just slow, so every page and every /api/* call always goes to network.
const STATIC_CACHE = "asc-static-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Next.js's own build output under /_next/static/ is content-hashed and immutable — safe
  // to serve cache-first and only ever fetch once per version.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
    );
  }
  // Everything else — pages, /api/* calls — no respondWith(), so the browser handles the
  // request exactly as it would with no service worker at all.
});
