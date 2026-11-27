/* Service worker — Caisse Ti-Coq (iPad Caisse) */
const VERSION = '1.1.0';
const APP_CACHE = 'tccaisse-' + VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', '../icons/icon-192.png', '../icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('tccaisse-') && k !== APP_CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
// Réseau d'abord (toujours la dernière version), cache si hors ligne.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const cp = res.clone(); caches.open(APP_CACHE).then((c) => c.put(req, cp)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
});
// Alarme envoyée par ti-coq.com (caisse pas ouverte / pas fermée à l'heure).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Caisse Ti-Coq', {
      body: d.body || '', tag: d.tag || 'caisse', renotify: true, requireInteraction: true,
      icon: '../icons/icon-192.png', badge: '../icons/icon-192.png', data: { url: d.url || './' }
    }),
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'refresh' })))
  ]));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) { if (c.url.startsWith(self.registration.scope)) { c.postMessage({ type: 'refresh' }); return c.focus(); } }
    return self.clients.openWindow(target);
  }));
});
