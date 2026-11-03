/*
 * The installed app's service worker.
 *
 * Its one job is to make C.H.A.T. open like an app: instantly, and even with a
 * poor connection. It is deliberately conservative, because a service worker
 * that caches the wrong thing is the hardest bug a web app can ship — it keeps
 * serving the old release long after the new one is deployed.
 *
 *   - /api/* is never touched. Reflections are private and always live; a
 *     cached answer could show one person's data after another signed in.
 *   - Pages (navigations) go to the network first. The last good index.html is
 *     kept only as the offline fallback, so a deploy is visible on next open.
 *   - /assets/* are content-hashed by Vite and never change, so they are served
 *     from the cache once fetched.
 *   - Everything else under this origin (icons, manifest) is served from cache
 *     and refreshed in the background.
 *
 * Bump VERSION to drop every cache on the next visit.
 */
const VERSION = 'v1';
const SHELL = `chat-shell-${VERSION}`;
const ASSETS = `chat-assets-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon-192.png'])).catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      for (const name of await caches.keys()) {
        if (!keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put('/', copy));
          }
          return response;
        } catch {
          return (await caches.match('/', { cacheName: SHELL })) ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request, { cacheName: ASSETS });
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const copy = response.clone();
          caches.open(ASSETS).then((cache) => cache.put(request, copy));
        }
        return response;
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request, { cacheName: SHELL });
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(SHELL).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })(),
  );
});
