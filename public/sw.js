/**
 * Offline shell.
 *
 * The app must open in a loft with no signal, so the shell is cached.
 * But the strategy differs by what is being fetched, and getting that
 * wrong ships an app that can never be updated:
 *
 *  - NAVIGATIONS AND HTML: network-first, cache as fallback. Cache-first
 *    here means a deployed change never reaches anyone — the stale HTML
 *    keeps pointing at the old hashed assets for ever. Verified the hard
 *    way: a cache-first shell served a fixed module's old copy back.
 *  - HASHED ASSETS (/assets/*): cache-first. Vite fingerprints them, so
 *    a given URL's content never changes and the network is pure cost.
 *  - EVERYTHING ELSE same-origin: network-first, falling back to cache,
 *    which keeps development honest and costs one request when online.
 *  - /api: never cached. A stale capture list is misleading, and writes
 *    are queued in IndexedDB by the page rather than retried here.
 */
const CACHE = 'vinyl-sorter-shell-v4';
const SHELL = ['/', '/index.html', '/capture.html', '/review.html', '/browse.html',
  '/settings.html', '/manifest.webmanifest', '/icon.svg', '/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    // Individually, so one 404 does not abandon the whole install.
    .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/** Immutable because Vite puts a content hash in the filename. */
const isHashedAsset = (url) => url.pathname.startsWith('/assets/');

async function networkFirst(request, url) {
  try {
    const res = await fetch(request);
    if (res.ok && url.origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
    }
    return res;
  } catch {
    const hit = await caches.match(request);
    if (hit) return hit;
    // A navigation with no cache entry and no network still opens —
    // AT THE PAGE IT ASKED FOR. Falling back to /index.html for
    // everything was right while the root WAS capture; now that the
    // root is a hub, it would answer "open the camera, I have no
    // signal" with a menu, which is the one thing the offline
    // guarantee exists to prevent (APP-HOME-HUB).
    if (request.mode === 'navigate') {
      const shell = await caches.match(url.pathname.startsWith('/capture')
        ? '/capture.html' : '/index.html');
      if (shell) return shell;
    }
    return Response.error();
  }
}

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (url.origin !== location.origin) return;

  e.respondWith(isHashedAsset(url) ? cacheFirst(e.request) : networkFirst(e.request, url));
});
