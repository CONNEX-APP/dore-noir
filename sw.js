/* Service worker — Domaine du Doré Noir */
const VERSION = '0.3.3';
const APP_CACHE = 'app-' + VERSION;
const TILE_CACHE = 'tuiles-v1';
const FONT_CACHE = 'polices-v1';
const PHOTO_CACHE = 'photos-v1';
const SAT_CACHE = 'satellite-v1';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'livre.js', 'master.js', 'manifest.webmanifest',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css',
  'data/base.geojson', 'data/seed.json', 'data/route.json', 'data/zone-hors-ligne.json', 'data/tiles.json',
  'icons/logo-complet.png', 'icons/embleme.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(APP_CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((k) => k.startsWith('app-') && k !== APP_CACHE).map((k) => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: false });
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
    return res;
  } catch (err) {
    return new Response('', { status: 504, statusText: 'Hors ligne' });
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tiles.openfreemap.org' && url.pathname !== '/planet') {
    e.respondWith(cacheFirst(req, TILE_CACHE));
    return;
  }
  if (url.hostname === 'servicesmatriciels.mern.gouv.qc.ca') {
    e.respondWith(cacheFirst(req, SAT_CACHE));
    return;
  }
  if ((url.hostname === 'drive.google.com' && url.pathname === '/thumbnail') || url.hostname.endsWith('googleusercontent.com')) {
    e.respondWith(cacheFirst(req, PHOTO_CACHE));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(cacheFirst(req, FONT_CACHE));
    return;
  }
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      e.respondWith(caches.open(APP_CACHE).then((c) => c.match('index.html')).then((r) => r || fetch(req)));
      return;
    }
    e.respondWith(caches.open(APP_CACHE).then((c) => c.match(req, { ignoreSearch: true })).then((r) => r || fetch(req)));
  }
});
