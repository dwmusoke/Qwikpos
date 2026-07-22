// Qwickpos — Service Worker
// Caches the app shell so the POS keeps working (viewing catalog, building
// carts, drafting sales) when the connection drops — sales sync to Supabase
// automatically once back online (see app.js -> flushOfflineQueue).

const CACHE_NAME = 'uganda-pos-v1';
const APP_SHELL = [
  './index.html',
  './uganda-pos-styles.css',
  './uganda-pos-app.js',
  './uganda-pos-manifest.json',
  './uganda-pos-icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Never cache Supabase API calls — always go to network so data stays live.
  if (request.url.includes('supabase.co') || request.url.includes('/rest/v1/') || request.url.includes('/auth/v1/')) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200 && request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
