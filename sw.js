// GEN Monitor — Service Worker
// Caches the app shell so it loads instantly and works offline
// showing the last known data when there's no internet.

const CACHE = 'genmonitor-v1';

// Files to cache on install — the app shell
const SHELL = [
  './dashboard.html',
  './style.css',
  './script.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Rajdhani:wght@400;500;600;700&display=swap',
];

// ── Install: cache the app shell ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch strategy:
//    • App shell files → cache first (instant load)
//    • Google Sheets API calls → network first, fall back to cache
//    • Everything else → network first
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Google Sheets API — network first, cache the last response as fallback
  if (url.includes('sheets.googleapis.com')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // App shell — cache first
  if (SHELL.some(s => url.includes(s.replace('./', '')))) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Default — network first
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
