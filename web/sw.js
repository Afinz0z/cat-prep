// Service worker: lets the site install as an app, keeps the pages working on a
// shaky connection, and opens the site when a notification is tapped.
// Pages are fetched fresh when online and served from the cache when not.
// Calls to the database are never cached.
const CACHE = "cat-prep-v5";
const FONTS = "cat-prep-fonts-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([
    "./", "index.html", "test.html", "practice.html", "css/site.css", "css/test.css", "js/early.js", "js/ui.js", "js/db.js",
    "js/config.js", "js/reminders.js", "js/plan.js", "js/home.js", "js/test.js", "js/calculator.js", "data/plan.json",
  ]).catch(() => {})));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE && key !== FONTS) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  // Google Fonts never change at a given address, so serve them from the cache first.
  if (req.method === "GET" && (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com")) {
    event.respondWith((async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const fresh = await fetch(req);
      if (fresh.ok || fresh.type === "opaque") {
        const copy = fresh.clone();
        caches.open(FONTS).then((c) => c.put(req, copy)).catch(() => {});
      }
      return fresh;
    })());
    return;
  }
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
    if (all.length) await all[0].focus();
    else await self.clients.openWindow("index.html");
  })());
});
