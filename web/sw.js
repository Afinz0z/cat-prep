// Service worker: lets the site install as an app, keeps the pages working on a
// shaky connection, and handles the "I drank a glass" button on notifications.
// Pages are fetched fresh when online and served from the cache when not.
// Calls to the database are never cached.
const CACHE = "cat-prep-v2";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    "./", "index.html", "css/site.css", "css/test.css", "js/ui.js", "js/db.js", "js/config.js", "js/reminders.js", "js/home.js",
  ]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh.ok) {
        const copy = fresh.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    } catch (err) {
      const hit = await caches.match(req, { ignoreSearch: req.mode === "navigate" });
      if (hit) return hit;
      throw err;
    }
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (event.action === "drank") {
      if (all.length) {
        all[0].postMessage({ type: "water" });
        return;
      }
      await self.clients.openWindow("index.html?water=1");
      return;
    }
    if (all.length) await all[0].focus();
    else await self.clients.openWindow("index.html");
  })());
});
