const CACHE = 'gharawi-shell-v9';
const SHELL = ['/app/', '/app/app.js?v=9', '/app/app.css?v=9', '/app/model.js?v=9', '/app/store.js?v=9', '/app/calendar.js?v=9', '/app/reminders.js?v=9', '/install.js?v=9', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('gharawi-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (event.request.mode === 'navigate' && url.pathname.startsWith('/app')) {
    event.respondWith(caches.open(CACHE).then(async cache => {
      try {
        const response = await fetch(event.request);
        if (response.ok) await cache.put('/app/', response.clone());
        return response;
      } catch {
        return cache.match('/app/');
      }
    }));
    return;
  }
  if (!SHELL.includes(url.pathname + url.search)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
