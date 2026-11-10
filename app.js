/* Domaine du Doré Noir — carte hors ligne v0.1 */
'use strict';
const APP_VERSION = '0.1.0';
const CHALET = [-73.942520, 47.096700];
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = 'Noto Sans Regular';
const TILE_CACHE = 'tuiles-v1';
const OFF_ROUTE_M = 150;

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = null) => { try { const v = localStorage.getItem('dn.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem('dn.' + k, JSON.stringify(v)); } catch (e) {} },
};

let map, data, route, zone, tilesList, meMarker, lastPos = null, heading = null;
let guiding = false, wakeLock = null, announced = new Set(), lastOffSpeak = 0;

/* ---------- Géométrie ---------- */
const R_EARTH = 6371000;
const rad = (d) => d * Math.PI / 180;
function dist(a, b) {
  const dLat = rad(b[1] - a[1]), dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]));
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
const DIRS = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
const dirName = (b) => DIRS[Math.round(b / 45) % 8];
function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 0 : 1).replace('.', ',') + ' km' : Math.round(m / 10) * 10 + ' m'; }
function pointInRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function inZone(p) {
  if (!zone) return true;
  const polys = zone.type === 'Polygon' ? [zone.coordinates] : zone.coordinates;
  return polys.some((poly) => pointInRing(p, poly[0]));
}
// Projection sur la route (mètres, équirectangulaire locale)
function snapToRoute(p) {
  const c = route.coords, k = Math.cos(rad(47.0)), M = 111320;
  const px = p[0] * k * M, py = p[1] * M;
  let best = { d: Infinity, along: 0 };
  for (let i = 0; i < c.length - 1; i++) {
    const ax = c[i][0] * k * M, ay = c[i][1] * M, bx = c[i + 1][0] * k * M, by = c[i + 1][1] * M;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
    const qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(px - qx, py - qy);
    if (d < best.d) best = { d, along: route.cum[i] + t * (route.cum[i + 1] - route.cum[i]) };
  }
  return best;
}

/* ---------- Style de carte ---------- */
function buildStyle() {
  const tpl = store.get('tileTemplate');
  const sources = { domaine: { type: 'geojson', data } };
  const layers = [{ id: 'fond', type: 'background', paint: { 'background-color': '#1B2015' } }];
  if (tpl) {
    sources.omt = { type: 'vector', tiles: [tpl], minzoom: 0, maxzoom: 14,
      attribution: '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank">contributeurs OpenStreetMap</a>' };
    layers.push(
      { id: 'foret', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'forest']]], paint: { 'fill-color': '#1F261A' } },
      { id: 'milieu-humide', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wetland'], paint: { 'fill-color': '#1D2A22' } },
      { id: 'eau-omt', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#1E3640', 'fill-outline-color': '#3E6576' } },
      { id: 'cours-eau', type: 'line', source: 'omt', 'source-layer': 'waterway', paint: { 'line-color': '#3E6576', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 15, 1.6] } },
      { id: 'chemins-omt', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['track', 'path', 'service', 'minor']]],
        paint: { 'line-color': '#5E6754', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 15, 2], 'line-dasharray': [3, 2] } },
      { id: 'routes-omt', type: 'line', source: 'omt', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary']]],
        paint: { 'line-color': '#8A8F7A', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.8, 15, 3] } },
    );
  }
  layers.push(
    { id: 'lacs', type: 'fill', source: 'domaine', filter: ['==', ['get', 'kind'], 'lac'], paint: { 'fill-color': '#1E3640' } },
    { id: 'zone-fill', type: 'fill', source: 'domaine', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'fill-color': '#9BC26B', 'fill-opacity': 0.08 } },
    { id: 'zone-ligne', type: 'line', source: 'domaine', filter: ['==', ['get', 'kind'], 'zone'], paint: { 'line-color': '#9BC26B', 'line-width': 2, 'line-dasharray': [3, 2] } },
    { id: 'sentiers', type: 'line', source: 'domaine', filter: ['==', ['get', 'kind'], 'sentier'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#FF7A2E', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 4] } },
    { id: 'pied', type: 'line', source: 'domaine', filter: ['==', ['get', 'kind'], 'pied'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#FFB27D', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3], 'line-dasharray': [1, 2] } },
    { id: 'acces-bord', type: 'line', source: 'domaine', filter: ['==', ['get', 'kind'], 'acces'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#14170F', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 9] } },
    { id: 'acces', type: 'line', source: 'domaine', filter: ['==', ['get', 'kind'], 'acces'], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#C9B98F', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.8, 16, 6] } },
  );
  if (tpl) {
    layers.push(
      { id: 'noms-lacs', type: 'symbol', source: 'omt', 'source-layer': 'water_name', minzoom: 11,
        layout: { 'text-field': ['get', 'name'], 'text-font': [FONT], 'text-size': 12, 'text-letter-spacing': 0.1 },
        paint: { 'text-color': '#7FA6B5', 'text-halo-color': '#14170F', 'text-halo-width': 1.2 } },
      { id: 'lieux', type: 'symbol', source: 'omt', 'source-layer': 'place',
        layout: { 'text-field': ['get', 'name'], 'text-font': [FONT], 'text-size': 13 },
        paint: { 'text-color': '#C5C8B8', 'text-halo-color': '#14170F', 'text-halo-width': 1.4 } },
    );
  }
  return { version: 8, glyphs: GLYPHS, sources, layers };
}

const ICONS = {
  chalet: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  cache: '<path d="M7 21l2-11h6l2 11M9 10V5h6v5M8 15h8"/>',
  saline: '<path d="M5 15h14l-2 5H7z"/><path d="M8 15l2-6h4l2 6"/>',
  fourche: '<path d="M12 21v-8M12 13L6 4M12 13l6-9"/>',
  esso: '<path d="M6 21V5a2 2 0 012-2h6a2 2 0 012 2v16M5 21h12M8 8h6"/><path d="M16 9l3 3v6a1.5 1.5 0 01-3 0v-3"/>',
  lieu: '<path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};
function addMarkers() {
  data.features.filter((f) => f.geometry.type === 'Point').forEach((f) => {
    const k = f.properties.kind in ICONS ? f.properties.kind : 'lieu';
    const el = document.createElement('div');
    el.className = 'mk ' + k;
    let label = f.properties.name.replace('Esso Saint-Michel-des-Saints', 'Esso St-Michel');
    el.innerHTML = '<div class="mk-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg></div><span class="mk-lbl"></span>';
    el.querySelector('.mk-lbl').textContent = label;
    el.title = f.properties.name;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const extra = lastPos ? ' · ' + fmtDist(dist(lastPos, f.geometry.coordinates)) + ' ' + dirName(bearing(lastPos, f.geometry.coordinates)) : '';
      toast(f.properties.name + extra);
    });
    new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat(f.geometry.coordinates).addTo(map);
  });
}

function initMap() {
  map = new maplibregl.Map({
    container: 'map', style: buildStyle(), center: CHALET, zoom: 13.2,
    attributionControl: false, pitchWithRotate: false, dragRotate: false, maxZoom: 17,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Données du domaine : Famille Richard-Benny' }), 'bottom-left');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
  map.on('load', addMarkers);
  map.on('error', (e) => { if (!navigator.onLine) return; console.warn('[DN] carte', e && e.error && e.error.message); });
}
function reloadStyle() { if (map) map.setStyle(buildStyle()); }

/* ---------- Téléchargement hors ligne ---------- */
async function downloadMap() {
  const btn = $('dl-btn');
  if (!navigator.onLine) { toast('Pas de réseau : connecte-toi pour télécharger la carte.'); return; }
  btn.disabled = true; $('dl-txt').textContent = 'Préparation…';
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    const tj = await (await fetch(TILEJSON, { cache: 'no-store' })).json();
    const tpl = tj.tiles[0];
    const oldTpl = store.get('tileTemplate');
    if (oldTpl && oldTpl !== tpl) await caches.delete(TILE_CACHE);
    const urls = tilesList.map(([z, x, y]) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    ['0-255', '256-511', '8192-8447'].forEach((r) => urls.push(GLYPHS.replace('{fontstack}', encodeURIComponent(FONT)).replace('{range}', r)));
    const cache = await caches.open(TILE_CACHE);
    let done = 0, fail = 0, bytes = 0, idx = 0;
    const worker = async () => {
      while (idx < urls.length) {
        const u = urls[idx++];
        try {
          let res = await cache.match(u);
          if (!res) {
            res = await fetch(u, { mode: 'cors' });
            if (res.ok || res.status === 204) { const b = await res.clone().blob(); bytes += b.size; await cache.put(u, res); } else fail++;
          }
        } catch (e) { fail++; }
        done++;
        $('dl-bar').style.width = Math.round(done / urls.length * 100) + '%';
        $('dl-txt').textContent = done + ' / ' + urls.length + ' tuiles';
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    store.set('tileTemplate', tpl);
    if (fail > urls.length * 0.05) {
      $('dl-txt').textContent = fail + ' tuiles manquantes — réessaie';
      store.set('carteOK', null);
    } else {
      const d = new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' });
      store.set('carteOK', d);
      $('dl-txt').textContent = 'Prête hors ligne · ' + (bytes / 1048576).toFixed(1).replace('.', ',') + ' Mo';
    }
    reloadStyle(); refreshStatus(); refreshSteps();
  } catch (e) {
    console.warn('[DN] téléchargement', e);
    $('dl-txt').textContent = 'Échec du téléchargement — réessaie';
  } finally { btn.disabled = false; }
}

/* ---------- GPS & boussole ---------- */
function startGps() {
  if (!('geolocation' in navigator)) { toast('GPS non disponible sur cet appareil.'); return; }
  if (startGps.on) return; startGps.on = true;
  navigator.geolocation.watchPosition(onPos, (err) => {
    startGps.on = false;
    $('retour-dir').textContent = err.code === 1 ? 'Localisation refusée : active-la dans les réglages' : 'GPS indisponible';
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 });
}
function onPos(pos) {
  const p = [pos.coords.longitude, pos.coords.latitude];
  lastPos = p; store.set('gpsOK', true); refreshSteps();
  if (!meMarker && map) { const el = document.createElement('div'); el.className = 'me'; meMarker = new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map); }
  else if (meMarker) meMarker.setLngLat(p);
  const box = $('gps-box'); box.hidden = false;
  box.innerHTML = '<span class="muted">GPS ±' + Math.round(pos.coords.accuracy) + ' m</span><br>' + p[1].toFixed(5) + '° N  ' + Math.abs(p[0]).toFixed(5) + '° O';
  if (followMe && map) map.easeTo({ center: p, duration: 600 });
  updateRetour();
  $('zone-alert').hidden = !(store.get('carteOK') && !inZone(p));
  if (guiding) updateGuide(pos);
}
let followMe = false;
function updateRetour() {
  if (!lastPos) return;
  const d = dist(lastPos, CHALET), b = bearing(lastPos, CHALET);
  $('retour-dist').textContent = d < 40 ? 'Tu es au chalet' : fmtDist(d);
  $('retour-dir').textContent = d < 40 ? '' : 'Vers le ' + dirName(b) + (heading === null ? ' · flèche : nord en haut' : '');
  const rot = heading === null ? b : b - heading;
  $('retour-arrow').style.transform = 'rotate(' + rot + 'deg)';
}
async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') { toast('Boussole refusée.'); return; }
    }
    window.addEventListener('deviceorientation', (e) => {
      if (typeof e.webkitCompassHeading === 'number') heading = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === 'number') heading = 360 - e.alpha;
      else return;
      updateRetour();
    });
    $('compass-btn').hidden = true; toast('Boussole activée : la flèche pointe vers le chalet.');
  } catch (e) { toast('Boussole indisponible.'); }
}

/* ---------- Guidage ---------- */
function renderReperes(along = -1) {
  const ol = $('g-list'); ol.innerHTML = '';
  route.reperes.forEach((r) => {
    const li = document.createElement('li');
    if (along >= 0 && r.km * 1000 < along - 30) li.className = 'passe';
    li.innerHTML = '<span class="km"></span><span><b></b><br><span class="muted small"></span></span>';
    li.querySelector('.km').textContent = 'KM ' + r.km.toFixed(1).replace('.', ',');
    li.querySelector('b').textContent = r.nom;
    li.querySelector('.small').textContent = r.consigne;
    ol.appendChild(li);
  });
}
function speak(t) {
  if (!$('g-voice').checked || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(t); u.lang = 'fr-CA'; u.rate = 1;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
async function toggleGuide() {
  guiding = !guiding;
  $('g-start').textContent = guiding ? 'ARRÊTER LE GUIDAGE' : 'DÉMARRER LE GUIDAGE';
  if (guiding) {
    startGps(); announced = new Set();
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {}
    speak('Guidage démarré vers le chalet.');
    if (lastPos) updateGuide({ coords: { longitude: lastPos[0], latitude: lastPos[1], accuracy: 0 } });
  } else { try { wakeLock && wakeLock.release(); } catch (e) {} wakeLock = null; }
}
document.addEventListener('visibilitychange', async () => {
  if (guiding && document.visibilityState === 'visible' && 'wakeLock' in navigator) { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) {} }
});
function updateGuide(pos) {
  const p = [pos.coords.longitude, pos.coords.latitude];
  const s = snapToRoute(p), total = route.cum[route.cum.length - 1];
  $('g-acc').textContent = pos.coords.accuracy ? '±' + Math.round(pos.coords.accuracy) + ' m' : '—';
  const off = $('g-off');
  if (s.d > OFF_ROUTE_M) {
    off.hidden = false;
    off.textContent = 'Tu n\'es plus sur la route du chalet (à ' + fmtDist(s.d) + '). Reviens vers le tracé beige.';
    if (Date.now() - lastOffSpeak > 60000) { speak('Attention : vous n\'êtes plus sur la route du chalet.'); lastOffSpeak = Date.now(); }
  } else off.hidden = true;
  $('g-km').textContent = 'KM ' + (s.along / 1000).toFixed(1).replace('.', ',');
  $('g-rest').textContent = fmtDist(Math.max(0, total - s.along));
  $('g-bar').style.width = Math.min(100, s.along / total * 100) + '%';
  const next = route.reperes.find((r) => r.km * 1000 > s.along + 30);
  if (next) {
    const dm = next.km * 1000 - s.along;
    $('g-next-dist').textContent = fmtDist(dm);
    $('g-next-name').textContent = next.nom;
    $('g-next-txt').textContent = next.consigne;
    [2000, 500, 150].forEach((th) => {
      const key = next.nom + th;
      if (dm <= th && !announced.has(key)) {
        announced.add(key);
        speak((th === 150 ? 'Bientôt : ' : 'Dans ' + fmtDist(th).replace(' km', ' kilomètres').replace(' m', ' mètres') + ' : ') + next.nom + '. ' + next.consigne);
      }
    });
  } else {
    $('g-next-dist').textContent = 'Arrivé';
    $('g-next-name').textContent = 'Chalet'; $('g-next-txt').textContent = 'Bienvenue au Domaine du Doré Noir!';
    if (!announced.has('arrive')) { announced.add('arrive'); speak('Vous êtes arrivé au chalet. Bienvenue!'); }
  }
  renderReperes(s.along);
}

/* ---------- Écrans, statut, mises à jour ---------- */
function isStandalone() { return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; }
function refreshSteps() {
  $('step-install').classList.toggle('done', isStandalone());
  $('step-dl').classList.toggle('done', !!store.get('carteOK'));
  $('step-gps').classList.toggle('done', !!store.get('gpsOK'));
  const first = ['step-install', 'step-dl', 'step-gps'].find((id) => !$(id).classList.contains('done'));
  ['step-install', 'step-dl', 'step-gps'].forEach((id) => $(id).classList.toggle('active', id === first));
  if (store.get('carteOK')) $('dl-txt').textContent = 'Prête hors ligne · ' + store.get('carteOK');
}
function refreshStatus() {
  const ok = store.get('carteOK'), el = $('st-offline');
  el.className = 'mono small ' + (ok ? 'ok' : 'warn');
  el.textContent = ok ? '✓ PRÊT HORS LIGNE' : '⚠ CARTE NON TÉLÉCHARGÉE';
  $('st-version').textContent = 'V' + APP_VERSION + (ok ? ' · CARTE DU ' + ok.toUpperCase() : '');
}
function showApp() {
  store.set('accueilVu', true);
  $('accueil').hidden = true; $('app').hidden = false;
  if (!map) initMap(); else map.resize();
  refreshStatus();
  if (store.get('gpsOK')) startGps();
}
function showAccueil() { $('app').hidden = true; $('accueil').hidden = false; refreshSteps(); }
function setView(v) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  ['carte', 'guidage', 'livre'].forEach((n) => { $('view-' + n).hidden = n !== v; });
  $('tb-sub').textContent = 'LAC BOUCHARD · ' + v.toUpperCase();
  if (v === 'carte' && map) setTimeout(() => map.resize(), 50);
}
let toastTimer;
function toast(msg, action) {
  const t = $('toast'); t.innerHTML = ''; const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = action.fn; t.appendChild(b); }
  t.hidden = false; clearTimeout(toastTimer); if (!action) toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const prompt = (w) => toast('Nouvelle version disponible', { label: 'Mettre à jour', fn: () => w.postMessage('skipWaiting') });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
    if (navigator.onLine) reg.update().catch(() => {});
  });
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
}

async function boot() {
  [data, route, zone, tilesList] = await Promise.all(
    ['data/carte.geojson', 'data/route.json', 'data/zone-hors-ligne.json', 'data/tiles.json'].map((u) => fetch(u).then((r) => r.json())));
  $('g-total').textContent = 'TOTAL ' + fmtDist(route.cum[route.cum.length - 1]);
  renderReperes();
  $('dl-btn').onclick = downloadMap;
  $('gps-btn').onclick = () => { startGps(); };
  $('enter-btn').onclick = showApp;
  $('compass-btn').onclick = enableCompass;
  $('g-start').onclick = toggleGuide;
  $('st-offline').onclick = () => { if (!store.get('carteOK')) showAccueil(); };
  $('btn-locate').onclick = () => {
    followMe = !followMe; $('btn-locate').classList.toggle('on', followMe);
    if (!lastPos) { startGps(); toast('Recherche du GPS…'); } else if (followMe) map.easeTo({ center: lastPos, zoom: Math.max(map.getZoom(), 14) });
  };
  $('btn-chalet').onclick = () => map.easeTo({ center: CHALET, zoom: 14.5 });
  document.querySelectorAll('.tab').forEach((t) => { t.onclick = () => setView(t.dataset.view); });
  window.addEventListener('online', refreshStatus); window.addEventListener('offline', refreshStatus);
  refreshSteps();
  if (store.get('accueilVu') && store.get('carteOK')) showApp(); else showAccueil();
  registerSW();
}
boot().catch((e) => { console.error('[DN] démarrage', e); document.body.insertAdjacentHTML('afterbegin', '<p style="padding:40px 20px">Erreur au démarrage. Reconnecte-toi au réseau et rouvre l\'app.</p>'); });
