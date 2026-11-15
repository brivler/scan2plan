/* Scan2Plan service worker (REQ-013, REQ-071): precaches every app file, cache-first,
   deletes old caches on activate, waits for the user before activating an update (REQ-064). */
importScripts('./src/precache-list.js');

const CACHE = `scan2plan-v${self.S2P_APP_VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(self.S2P_PRECACHE.map((p) => new Request(p, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('scan2plan-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('./index.html') : null);
    return hit || fetch(req);
  })());
});
