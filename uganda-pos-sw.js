// Qwickpos — Service Worker
// Caches the app shell so the POS keeps working (viewing catalog, building
// carts, drafting sales) when the connection drops — sales sync to Supabase
// automatically once back online (see app.js -> flushOfflineQueue).

const CACHE_NAME = "uganda-pos-v9";
const APP_SHELL = [
  "./",
  "./index.html",
  "./uganda-pos-styles.css",
  "./uganda-pos-core.js",
  "./uganda-pos-app.js",
  "./uganda-pos-i18n.js",
  "./uganda-pos-view-dashboard.js",
  "./uganda-pos-view-pos.js",
  "./uganda-pos-view-quotations.js",
  "./uganda-pos-view-products.js",
  "./uganda-pos-view-inventory.js",
  "./uganda-pos-view-sales.js",
  "./uganda-pos-view-purchases.js",
  "./uganda-pos-view-customers.js",
  "./uganda-pos-view-suppliers.js",
  "./uganda-pos-view-efris.js",
  "./uganda-pos-view-reports.js",
  "./uganda-pos-view-accounting.js",
  "./uganda-pos-view-settings.js",
  "./uganda-pos-view-billing.js",
  "./uganda-pos-view-admin.js",
  "./uganda-pos-view-chat.js",
  "./uganda-pos-view-notifications.js",
  "./uganda-pos-view-signup.js",
  "./uganda-pos-view-audit.js",
  "./uganda-pos-view-notifications-center.js",
  "./uganda-pos-view-leads.js",
  "./uganda-pos-view-deliveries.js",
  "./uganda-pos-view-hrm.js",
  "./uganda-pos-view-templates.js",
  "./uganda-pos-view-backup.js",
  "./uganda-pos-manifest.json",
  "./uganda-pos-icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never cache Supabase API calls — always go to network so data stays live.
  if (
    request.url.includes("supabase.co") ||
    request.url.includes("/rest/v1/") ||
    request.url.includes("/auth/v1/")
  ) {
    return;
  }

  // JS files: network-first to always get latest code after deploys
  if (request.url.endsWith(".js")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request)),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (response && response.status === 200 && request.method === "GET") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
    }),
  );
});

// Push notification handler
self.addEventListener("push", (event) => {
  let data = { title: "Qwickpos", body: "" };
  try {
    data = event.data.json();
  } catch (_) {
    data.body = event.data?.text() || "";
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./uganda-pos-icon.svg",
      badge: "./uganda-pos-icon.svg",
      data: data.data || {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes(self.location.origin) && "focus" in client) {
            client.focus();
            if (event.notification.data?.route) {
              client.postMessage({
                type: "NAVIGATE",
                route: event.notification.data.route,
              });
            }
            return;
          }
        }
        clients.openWindow("./");
      }),
  );
});
