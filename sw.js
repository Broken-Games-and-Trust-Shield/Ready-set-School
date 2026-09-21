const cacheName = 'ready-set-school-v6-single-session';
const appFiles = ['./', './index.html', './styles.css', './app.js', './manifest.json', './icon-192.svg', './icon-512.svg'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appFiles)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() || '' }; }
  const title = data.title || 'Ready Set School';
  const options = {
    body: data.body || 'You have a school reminder.',
    icon: './icon-192.svg',
    badge: './icon-192.svg',
    tag: data.tag || 'ready-set-school-reminder',
    data: { url: data.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((window) => 'focus' in window);
    return existing ? existing.focus() : clients.openWindow(event.notification.data.url);
  }));
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    caches.open(cacheName).then((cache) => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
