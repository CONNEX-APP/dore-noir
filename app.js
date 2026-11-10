/* Domaine du Doré Noir — carte hors ligne, guidage, livre, mode Master */
'use strict';
const APP_VERSION = '0.2.0';
const API = 'COLLER_URL_SCRIPT_ICI';
const CHALET = [-73.942520, 47.096700];
const TILEJSON = 'https://tiles.openfreemap.org/planet';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = 'Noto Sans Regular';
const TILE_CACHE = 'tuiles-v1';
const OFF_ROUTE_M = 150;

const $ = (id) => document.getElementById(id);
const store = {
  get: (k, d = null) => { try { const v = localStorage.getItem('dn.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: (k, v) => { try { localStorage.setItem('dn.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
const apiOk = () => /^https:\/\/script\.google\.com\//.test(API);
const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 10);

let map, base, dyn, route, zone, tilesList, meMarker, lastPos = null, lastAcc = null, heading = null;
let markers = [], guiding = false, wakeLock = null, announced = new Set(), lastOffSpeak = 0;
const hooks = { onPos: [], onData: [], onMarker: null, onMapClick: null };

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
const lineLength = (c) => c.reduce((s, p, i) => (i ? s + dist(c[i - 1], p) : 0), 0);
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
  if (polys.some((poly) => pointInRing(p, poly[0]))) return true;
  return (dyn ? dyn.traces : []).some((t) => t.coords.some((c, i) => i % 5 === 0 && dist(p, c) < 1000));
}
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
// Simplification (Douglas-Peucker, tolérance en mètres)
function simplify(coords, tol) {
  if (coords.length < 3) return coords;
  const k = Math.cos(rad(coords[0][1])) * 111320, M = 111320;
  const keep = new Uint8Array(coords.length); keep[0] = keep[coords.length - 1] = 1;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let md = 0, mi = -1;
    const ax = coords[a][0] * k, ay = coords[a][1] * M, bx = coords[b][0] * k, by = coords[b][1] * M;
    for (let i = a + 1; i < b; i++) {
      const px = coords[i][0] * k, py = coords[i][1] * M, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
      let t = ((px - ax) * dx + (py - ay) * dy) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > md) { md = d; mi = i; }
    }
    if (md > tol) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return coords.filter((_, i) => keep[i]).map((c) => [+c[0].toFixed(6), +c[1].toFixed(6)]);
}

/* ---------- Données ---------- */
function reperesTries() {
  return (dyn.reperes || []).map((r) => Object.assign({}, r, { km: Math.round(snapToRoute([r.lon, r.lat]).along / 10) / 100 }))
    .sort((a, b) => a.km - b.km);
}
function featureCollection() {
  const f = base.features.slice();
  dyn.traces.forEach((t) => f.push({ type: 'Feature', properties: { id: t.id, name: t.nom, kind: t.type, vis: t.visibilite }, geometry: { type: 'LineString', coordinates: t.coords } }));
  return { type: 'FeatureCollection', features: f };
}
function setDyn(d, save = true) {
  dyn = { points: d.points || [], traces: d.traces || [], reperes: d.reperes || [], histoires: d.histoires || [] };
  if (save) store.set('dyn', dyn);
  if (map && map.getSource('domaine')) map.getSource('domaine').setData(featureCollection());
  if (map) renderMarkers();
  renderReperes();
  hooks.onData.forEach((fn) => fn());
}
async function api(body) {
  if (!apiOk()) throw new Error('serveur non branché');
  const opts = body ? { method: 'POST', body: JSON.stringify(body) } : { cache: 'no-store' };
  const res = await fetch(API, opts);
  const j = await res.json();
  if (!j.ok) throw new Error(j.erreur || 'erreur serveur');
  return j;
}
async function refreshRemote() {
  if (!apiOk() || !navigator.onLine) return;
  try {
    const pm = typeof masterData === 'function' ? masterData() : null;
    const j = pm ? await pm : await api();
    if (typeof applyPendingOps === 'function') applyPendingOps(j);
    setDyn(j);
    prefetchTraceTiles();
  } catch (e) { console.warn('[DN] données', e.message); }
}

/* ---------- Style de carte ---------- */
function buildStyle() {
  const tpl = store.get('tileTemplate');
  const sources = { domaine: { type: 'geojson', data: featureCollection() }, selection: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } };
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
  const isK = (k) => ['==', ['get', 'kind'], k];
  layers.push(
    { id: 'lacs', type: 'fill', source: 'domaine', filter: isK('lac'), paint: { 'fill-color': '#1E3640' } },
    { id: 'zone-fill', type: 'fill', source: 'domaine', filter: isK('zone'), paint: { 'fill-color': '#9BC26B', 'fill-opacity': 0.08 } },
    { id: 'zone-ligne', type: 'line', source: 'domaine', filter: isK('zone'), paint: { 'line-color': '#9BC26B', 'line-width': 2, 'line-dasharray': [3, 2] } },
    { id: 'sentiers', type: 'line', source: 'domaine', filter: isK('sentier'), layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['case', ['==', ['get', 'vis'], 'master'], '#B86AE8', '#FF7A2E'], 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 4] } },
    { id: 'pied', type: 'line', source: 'domaine', filter: isK('pied'), layout: { 'line-cap': 'round' }, paint: { 'line-color': '#FFB27D', 'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1.2, 16, 3], 'line-dasharray': [1, 2] } },
    { id: 'acces-bord', type: 'line', source: 'domaine', filter: isK('acces'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#14170F', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 16, 9] } },
    { id: 'acces', type: 'line', source: 'domaine', filter: isK('acces'), layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#C9B98F', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1.8, 16, 6] } },
    { id: 'selection', type: 'line', source: 'selection', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['coalesce', ['get', 'color'], '#FF4D3D'], 'line-width': 7, 'line-opacity': 0.9 } },
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
function setSelection(features) { if (map && map.getSource('selection')) map.getSource('selection').setData({ type: 'FeatureCollection', features }); }

const ICONS = {
  chalet: '<path d="M4 11l8-7 8 7M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  cache: '<path d="M7 21l2-11h6l2 11M9 10V5h6v5M8 15h8"/>',
  saline: '<path d="M5 15h14l-2 5H7z"/><path d="M8 15l2-6h4l2 6"/>',
  fourche: '<path d="M12 21v-8M12 13L6 4M12 13l6-9"/>',
  depart: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  danger: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  peche: '<path d="M3 12c4-6 10-6 14 0-4 6-10 6-14 0z"/><path d="M17 12l4-3v6z"/>',
  stationnement: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M10 16V8h3a2.5 2.5 0 010 5h-3"/>',
  camera: '<rect x="3" y="7" width="14" height="11" rx="2"/><path d="M17 11l4-2v8l-4-2"/><circle cx="10" cy="12.5" r="2.5"/>',
  lieu: '<path d="M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>',
};
const TYPES_POINT = { cache: 'Cache', saline: 'Saline', peche: 'Spot de pêche', camera: 'Caméra', danger: 'Danger', stationnement: 'Stationnement', fourche: 'Embranchement', chalet: 'Chalet', depart: 'Départ', lieu: 'Autre' };
const shortName = (n) => n.replace('Esso Saint-Michel-des-Saints', 'Esso St-Michel').replace('Départ — 500, rue des Aulnaies', 'Départ').replace('Accueil Pins-rouges — Zec Gros Brochet', 'Accueil Zec');
function renderMarkers() {
  markers.forEach((m) => m.remove()); markers = [];
  dyn.points.forEach((p) => {
    const k = p.type in ICONS ? p.type : 'lieu';
    const el = document.createElement('div');
    el.className = 'mk ' + k + (p.visibilite === 'master' ? ' prive' : '');
    el.innerHTML = '<div class="mk-ico"><svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS[k] + '</svg></div><span class="mk-lbl"></span>';
    el.querySelector('.mk-lbl').textContent = shortName(p.nom);
    el.title = p.nom;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (hooks.onMarker && hooks.onMarker(p)) return;
      const extra = lastPos ? ' · ' + fmtDist(dist(lastPos, [p.lon, p.lat])) + ' ' + dirName(bearing(lastPos, [p.lon, p.lat])) : '';
      toast(p.nom + extra + (p.note ? ' — ' + p.note : ''));
    });
    markers.push(new maplibregl.Marker({ element: el, anchor: 'top' }).setLngLat([p.lon, p.lat]).addTo(map));
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
  map.on('load', renderMarkers);
  map.on('click', (e) => { if (hooks.onMapClick) hooks.onMapClick(e); });
  map.on('error', (e) => { if (navigator.onLine) console.warn('[DN] carte', e && e.error && e.error.message); });
}
function reloadStyle() { if (map) map.setStyle(buildStyle()); }

/* ---------- Tuiles hors ligne ---------- */
function lon2x(lon, z) { return Math.floor((lon + 180) / 360 * 2 ** z); }
function lat2y(lat, z) { return Math.floor((1 - Math.asinh(Math.tan(rad(lat))) / Math.PI) / 2 * 2 ** z); }
function traceTiles() {
  const set = new Set(tilesList.map((t) => t.join('/'))), extra = [];
  const add = (z, x, y) => { const k = z + '/' + x + '/' + y; if (!set.has(k)) { set.add(k); extra.push([z, x, y]); } };
  (dyn.traces || []).forEach((t) => {
    const c = t.coords; if (!c.length) return;
    const pts = c.filter((_, i) => i % 4 === 0).concat([c[c.length - 1]]);
    const dLat = 1000 / 111320;
    pts.forEach(([lon, lat]) => {
      const dLon = dLat / Math.cos(rad(lat));
      for (let z = 10; z <= 14; z++) {
        for (let x = lon2x(lon - dLon, z); x <= lon2x(lon + dLon, z); x++) for (let y = lat2y(lat + dLat, z); y <= lat2y(lat - dLat, z); y++) add(z, x, y);
      }
    });
    // Remplir les boucles : tracé fermé (début et fin à moins de 300 m)
    if (c.length > 10 && dist(c[0], c[c.length - 1]) < 300) {
      const lons = c.map((p) => p[0]), lats = c.map((p) => p[1]);
      for (let z = 12; z <= 14; z++) {
        for (let x = lon2x(Math.min(...lons), z); x <= lon2x(Math.max(...lons), z); x++) {
          for (let y = lat2y(Math.max(...lats), z); y <= lat2y(Math.min(...lats), z); y++) {
            const n = 2 ** z, clon = (x + 0.5) / n * 360 - 180, clat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n))) * 180 / Math.PI;
            if (pointInRing([clon, clat], c)) add(z, x, y);
          }
        }
      }
    }
  });
  return extra;
}
async function fetchToCache(urls, onProgress) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0, fail = 0, bytes = 0, idx = 0;
  const worker = async () => {
    while (idx < urls.length) {
      const u = urls[idx++];
      try {
        if (!(await cache.match(u))) {
          const res = await fetch(u, { mode: 'cors' });
          if (res.ok || res.status === 204) { bytes += (await res.clone().blob()).size; await cache.put(u, res); } else fail++;
        }
      } catch (e) { fail++; }
      done++; if (onProgress) onProgress(done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return { fail, bytes };
}
const tileUrl = (tpl, [z, x, y]) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
let prefetching = false;
async function prefetchTraceTiles() {
  const tpl = store.get('tileTemplate');
  if (prefetching || !tpl || !store.get('carteOK') || !navigator.onLine) return;
  prefetching = true;
  try { const extra = traceTiles(); if (extra.length) await fetchToCache(extra.map((t) => tileUrl(tpl, t))); } finally { prefetching = false; }
}
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
    const urls = tilesList.concat(traceTiles()).map((t) => tileUrl(tpl, t));
    ['0-255', '256-511', '8192-8447'].forEach((r) => urls.push(GLYPHS.replace('{fontstack}', encodeURIComponent(FONT)).replace('{range}', r)));
    const { fail, bytes } = await fetchToCache(urls, (d, n) => { $('dl-bar').style.width = Math.round(d / n * 100) + '%'; $('dl-txt').textContent = d + ' / ' + n + ' tuiles'; });
    store.set('tileTemplate', tpl);
    if (fail > urls.length * 0.05) {
      $('dl-txt').textContent = fail + ' tuiles manquantes — réessaie';
      store.set('carteOK', null);
    } else {
      store.set('carteOK', new Date().toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' }));
      $('dl-txt').textContent = 'Prête hors ligne · ' + (bytes / 1048576).toFixed(1).replace('.', ',') + ' Mo';
    }
    reloadStyle(); refreshStatus(); refreshSteps();
  } catch (e) {
    console.warn('[DN] téléchargement', e);
    $('dl-txt').textContent = 'Échec du téléchargement — réessaie';
  } finally { btn.disabled = false; }
}

/* ---------- GPS & boussole ---------- */
let followMe = false;
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
  lastPos = p; lastAcc = pos.coords.accuracy; store.set('gpsOK', true); refreshSteps();
  if (!meMarker && map) { const el = document.createElement('div'); el.className = 'me'; meMarker = new maplibregl.Marker({ element: el }).setLngLat(p).addTo(map); }
  else if (meMarker) meMarker.setLngLat(p);
  const box = $('gps-box'); box.hidden = false;
  box.innerHTML = '<span class="muted">GPS ±' + Math.round(pos.coords.accuracy) + ' m</span><br>' + p[1].toFixed(5) + '° N  ' + Math.abs(p[0]).toFixed(5) + '° O';
  if (followMe && map) map.easeTo({ center: p, duration: 600 });
  updateRetour();
  $('zone-alert').hidden = !(store.get('carteOK') && !inZone(p));
  if (guiding) updateGuide(pos);
  hooks.onPos.forEach((fn) => fn(pos));
}
function updateRetour() {
  if (!lastPos) return;
  const d = dist(lastPos, CHALET), b = bearing(lastPos, CHALET);
  $('retour-dist').textContent = d < 40 ? 'Tu es au chalet' : fmtDist(d);
  $('retour-dir').textContent = d < 40 ? '' : 'Vers le ' + dirName(b) + (heading === null ? ' · flèche : nord en haut' : '');
  $('retour-arrow').style.transform = 'rotate(' + (heading === null ? b : b - heading) + 'deg)';
}
async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      if ((await DeviceOrientationEvent.requestPermission()) !== 'granted') { toast('Boussole refusée.'); return; }
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
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    if (!on && wakeLock) { wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (guiding || window.recording)) keepAwake(true); });

/* ---------- Guidage ---------- */
function renderReperes(along = -1) {
  const ol = $('g-list'); if (!ol || !dyn) return; ol.innerHTML = '';
  reperesTries().forEach((r) => {
    const li = document.createElement('li');
    if (along >= 0 && r.km * 1000 < along - 30) li.className = 'passe';
    li.innerHTML = '<span class="km"></span><span><b></b><br><span class="muted small"></span></span>';
    li.querySelector('.km').textContent = r.km.toFixed(1).replace('.', ',') + ' km';
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
    startGps(); announced = new Set(); keepAwake(true);
    speak('Guidage démarré vers le chalet.');
    if (lastPos) updateGuide({ coords: { longitude: lastPos[0], latitude: lastPos[1], accuracy: 0 } });
  } else if (!window.recording) keepAwake(false);
}
function updateGuide(pos) {
  const p = [pos.coords.longitude, pos.coords.latitude];
  const s = snapToRoute(p), total = route.cum[route.cum.length - 1], reps = reperesTries();
  $('g-acc').textContent = pos.coords.accuracy ? '±' + Math.round(pos.coords.accuracy) + ' m' : '—';
  const off = $('g-off');
  if (s.d > OFF_ROUTE_M) {
    off.hidden = false;
    off.textContent = 'Tu n\'es plus sur la route du chalet (à ' + fmtDist(s.d) + '). Reviens vers le tracé beige.';
    if (Date.now() - lastOffSpeak > 60000) { speak('Attention : vous n\'êtes plus sur la route du chalet.'); lastOffSpeak = Date.now(); }
  } else off.hidden = true;
  $('g-km').textContent = fmtDist(s.along);
  $('g-rest').textContent = fmtDist(Math.max(0, total - s.along));
  $('g-bar').style.width = Math.min(100, s.along / total * 100) + '%';
  const next = reps.find((r) => r.km * 1000 > s.along + 30);
  if (next) {
    const dm = next.km * 1000 - s.along;
    $('g-next-dist').textContent = fmtDist(dm);
    $('g-next-name').textContent = next.nom;
    $('g-next-txt').textContent = next.consigne;
    [2000, 500, 150].forEach((th) => {
      const key = next.id + th;
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

/* ---------- Écrans, statut, boîtes de dialogue ---------- */
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
  $('st-version').textContent = 'V' + APP_VERSION + (ok ? ' · CARTE DU ' + ok.toUpperCase() : '') + (navigator.onLine ? '' : ' · HORS RÉSEAU');
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
  ['carte', 'guidage', 'livre', 'master'].forEach((n) => { $('view-' + n).hidden = n !== v; });
  $('tb-sub').textContent = 'LAC BOUCHARD · ' + v.toUpperCase();
  if (v === 'carte' && map) setTimeout(() => map.resize(), 50);
}
let toastTimer;
function toast(msg, action) {
  const t = $('toast'); t.innerHTML = ''; const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
  if (action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = action.label; b.onclick = () => { t.hidden = true; action.fn(); }; t.appendChild(b); }
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, action ? 9000 : 4000);
}
// Boîte de dialogue générique : fields = [{name,label,type,value,options,required,placeholder}]
function dialog(title, fields, buttons) {
  return new Promise((resolve) => {
    const wrap = $('dialog'), form = $('dialog-form');
    $('dialog-title').textContent = title; form.innerHTML = '';
    fields.forEach((f) => {
      if (f.type === 'html') { const d = document.createElement('div'); d.className = 'small muted'; d.textContent = f.text; form.appendChild(d); return; }
      const lab = document.createElement('label'); lab.className = 'fld';
      const sp = document.createElement('span'); sp.textContent = f.label + (f.required ? ' *' : ''); lab.appendChild(sp);
      let inp;
      if (f.type === 'select') {
        inp = document.createElement('select');
        Object.entries(f.options).forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; inp.appendChild(o); });
      } else if (f.type === 'textarea') { inp = document.createElement('textarea'); inp.rows = 5; }
      else { inp = document.createElement('input'); inp.type = f.type || 'text'; if (f.type === 'file') { inp.accept = f.accept || ''; inp.multiple = !!f.multiple; } }
      if (f.hidden) lab.hidden = true;
      if (f.type === 'checkbox') { inp.checked = !!f.value; lab.classList.add('fld-check'); }
      else if (f.type !== 'file' && f.value !== undefined) inp.value = f.value;
      if (f.placeholder) inp.placeholder = f.placeholder;
      if (f.inputmode) inp.inputMode = f.inputmode;
      if (f.autocomplete) inp.autocomplete = f.autocomplete;
      inp.name = f.name; lab.appendChild(inp); form.appendChild(lab);
    });
    const bar = document.createElement('div'); bar.className = 'dialog-btns';
    (buttons || [{ label: 'Annuler', value: null }, { label: 'Enregistrer', value: 'ok', primary: true }]).forEach((b) => {
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = b.label;
      btn.className = b.primary ? 'btn-primary' : b.danger ? 'btn-danger' : 'btn-sm';
      btn.onclick = () => {
        const out = {};
        fields.forEach((f) => { if (!f.name) return; const el = form.elements[f.name]; out[f.name] = f.type === 'checkbox' ? el.checked : f.type === 'file' ? el.files : el.value.trim(); });
        if (b.value === 'ok' && fields.some((f) => f.required && !out[f.name])) { toast('Remplis les champs obligatoires.'); return; }
        wrap.hidden = true; resolve(b.value === null ? null : Object.assign({ _btn: b.value }, out));
      };
      bar.appendChild(btn);
    });
    form.appendChild(bar);
    wrap.hidden = false;
    const first = form.querySelector('input:not([type=file]):not([type=checkbox]),textarea'); if (first && !('ontouchstart' in window)) first.focus();
  });
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
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
  let seed;
  [base, route, zone, tilesList, seed] = await Promise.all(
    ['data/base.geojson', 'data/route.json', 'data/zone-hors-ligne.json', 'data/tiles.json', 'data/seed.json'].map((u) => fetch(u).then((r) => r.json())));
  setDyn(store.get('dyn') || seed, false);
  $('g-total').textContent = 'TOTAL ' + fmtDist(route.cum[route.cum.length - 1]);
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
  window.addEventListener('online', () => { refreshStatus(); refreshRemote(); hooks.onData.forEach((fn) => fn('online')); });
  window.addEventListener('offline', refreshStatus);
  refreshSteps();
  if (store.get('accueilVu') && store.get('carteOK')) showApp(); else showAccueil();
  registerSW();
  if (typeof initLivre === 'function') initLivre();
  if (typeof initMaster === 'function') initMaster();
  refreshRemote();
}
boot().catch((e) => { console.error('[DN] démarrage', e); document.body.insertAdjacentHTML('afterbegin', '<p style="padding:40px 20px">Erreur au démarrage. Reconnecte-toi au réseau et rouvre l\'app.</p>'); });
