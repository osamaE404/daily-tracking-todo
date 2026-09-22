const CACHE = 'gharawi-shell-v5';
const SHELL = ['/app/', '/app/app.js?v=5', '/app/app.css?v=5', '/app/model.js?v=5', '/app/store.js?v=5', '/app/calendar.js?v=5', '/app/reminders.js?v=5', '/install.js?v=5', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('gharawi-shell-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname + url.search)) return;
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
});
