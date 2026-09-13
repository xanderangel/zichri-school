// Deliberately minimal. This exists mainly to satisfy what browsers
// require before offering "Install app" / "Add to Home Screen" — it does
// NOT try to make the app usable offline, since this is a live data app
// (report cards, scores, accounts) where showing stale cached data would
// be actively misleading. Only the static shell (HTML/CSS/JS) is cached,
// using a network-first strategy so a real connection always wins and
// the cache is only ever a fallback. API calls (/api/...) and uploaded
// files (/files/...) are never intercepted here at all — they always go
// straight to the network, exactly as if this service worker didn't exist
// for those paths.

const CACHE_NAME = "zichri-shell-v1";
const SHELL_FILES = ["/", "/index.html", "/css/styles.css", "/js/app.js", "/js/api.js", "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept API calls or uploaded-file downloads — always live network.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/files/")) return;

  // Only handle GET requests for the app shell; everything else passes through untouched.
  if (event.request.method !== "GET" || !SHELL_FILES.includes(url.pathname)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
