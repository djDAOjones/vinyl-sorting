/**
 * Offline shell. The app must open in a loft with no signal, so the
 * shell is cached on install and served cache-first.
 *
 * /api is never cached: a stale capture list would be misleading, and
 * writes are queued in IndexedDB by the page rather than retried here.
 */
const CACHE = 'deep-groove-shell-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;

  e.respondWith(
    caches.match(e.request).then((hit) => hit ?? fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          void caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      // A navigation with no cache entry and no network still opens.
      .catch(() => caches.match('/index.html').then((shell) => shell ?? Response.error()))),
  );
});
