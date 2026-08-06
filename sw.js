// Minimal offline cache for Nefesh - cache-first for GET requests, including
// cross-origin ones (the Google Fonts stylesheet/font files), which the
// previous version explicitly skipped, silently requiring a live connection
// every load just to render text. Bump CACHE_NAME whenever index.html
// changes meaningfully so old clients pick up the new version instead of
// being stuck on a stale cached copy.
const CACHE_NAME = 'nefesh-cache-v10';
const PRECACHE_URLS = [
  './index.html',
  './manifest.json',
  './icons/favicon-32.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './sounds/dice.m4a',
  './sounds/move.ogg',
  './sounds/capture.ogg',
  './sounds/win.ogg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(
      names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  // Google Fonts' font FILES (fonts.gstatic.com) are fetched as opaque
  // cross-origin responses, which can still be cached and replayed offline
  // even though their status can't be inspected - only their own stylesheet
  // origin (fonts.googleapis.com) returns a normal, inspectable response.
  const isFontHost = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request).then((response) => {
        const cacheable = response && (response.ok || (isFontHost && response.type === 'opaque'));
        if (cacheable) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
