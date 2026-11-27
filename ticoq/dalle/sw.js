/* Service worker — Dalle Ti-Coq (iPad Dalle) : l'app s'ouvre même sans réseau. */
const VERSION = '1.0.0';
const APP_CACHE = 'tcdalle-' + VERSION;
const SHELL = ['./', 'index.html', 'app.js', 'manifest.webmanifest', '../icons/icon-192.png', '../icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('tcdalle-') && k !== APP_CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
// Réseau d'abord (dernière version), cache si hors ligne. Seulement les fichiers de l'app.
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
