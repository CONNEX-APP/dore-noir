/* Mode Master — Kevin seulement (NIP) */
'use strict';
window.masterNip = null;

async function sha(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('dore-noir:' + s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
}
function masterData() {
  if (!window.masterNip || !navigator.onLine || !apiOk()) return null;
  return api({ action: 'master.donnees', nip: window.masterNip });
}

/* ---------- Déverrouillage ---------- */
async function demanderNip() {
  if (window.masterNip) { setView('master'); return; }
  const r = await dialog('Mode Master', [{ name: 'nip', label: 'NIP', type: 'password', required: true, inputmode: 'numeric', autocomplete: 'off' }],
    [{ label: 'Annuler', value: null }, { label: 'Entrer', value: 'ok', primary: true }]);
  if (!r) return;
  let ok = false;
  if (navigator.onLine && apiOk()) {
    try { ok = (await fetch(API, { method: 'POST', body: JSON.stringify({ action: 'master.verifier', nip: r.nip }) }).then((x) => x.json())).ok; }
    catch (e) { ok = store.get('nipHash') === await sha(r.nip); }
  } else ok = !!store.get('nipHash') && store.get('nipHash') === await sha(r.nip);
  if (!ok) { toast(apiOk() ? 'NIP refusé.' : 'Le serveur Google n\'est pas encore branché.'); return; }
  store.set('nipHash', await sha(r.nip));
  window.masterNip = r.nip;
  document.body.classList.add('master');
  $('tab-master').hidden = false;
  setView('master'); renderMaster(); refreshRemote(); renderLivre();
  toast('Mode Master activé.');
}
function quitterMaster() {
  window.masterNip = null; document.body.classList.remove('master'); $('tab-master').hidden = true;
  if (drawing) finDessin(); if (edit) finEdit(); setSatellite(false); $('btn-sat-dl').hidden = true;
  hooks.onMapClick = null; setSelection([]); setView('carte'); renderLivre(); refreshRemote();
}

/* ---------- File de modifications ---------- */
const getOps = () => store.get('ops', []);
function applyOp(d, op) {
  const lists = { point: 'points', trace: 'traces', repere: 'reperes', histoire: 'histoires' };
  const arr = d[lists[op.type]] = (d[lists[op.type]] || []).slice();
  const i = arr.findIndex((x) => x.id === op.id);
  if (op.supprimer) { if (i >= 0) arr.splice(i, 1); return; }
  const obj = Object.assign({}, i >= 0 ? arr[i] : {}, op.data, { id: op.id });
  if (i >= 0) arr[i] = obj; else arr.push(obj);
}
function applyPendingOps(d) { getOps().forEach((op) => applyOp(d, op)); return d; }
function queue(op) {
  op.uid = uid('op');
  const ops = getOps(); ops.push(op);
  if (!store.set('ops', ops)) { toast('Mémoire pleine : synchronise avant de continuer.'); return; }
  const d = JSON.parse(JSON.stringify(dyn)); applyOp(d, op); setDyn(d);
  renderMaster(); syncMaster();
}
let syncing = false;
async function syncMaster() {
  const ops = getOps();
  if (syncing || !ops.length || !window.masterNip || !navigator.onLine || !apiOk()) { renderSyncState(); return; }
  syncing = true; renderSyncState();
  try {
    const j = await api({ action: 'master.sync', nip: window.masterNip, ops });
    const done = new Set(j.faits || []);
    store.set('ops', getOps().filter((o) => !done.has(o.uid)));
    await refreshRemote();
  } catch (e) { console.warn('[DN] sync', e.message); }
  finally { syncing = false; renderSyncState(); }
}
function renderSyncState() {
  const n = getOps().length, el = $('m-sync');
  if (!el) return;
  el.textContent = syncing ? 'Synchronisation…' : n ? n + ' changement' + (n > 1 ? 's' : '') + ' en attente' + (navigator.onLine ? '' : ' (hors réseau)') : '✓ Tout est synchronisé';
  el.className = 'mono small ' + (n ? 'warn' : 'ok');
}

/* ---------- Position : GPS ou centre de la carte ---------- */
const crosshair = (on) => { $('crosshair').hidden = !on; };
async function choisirPosition(titre) {
  const r = await dialog(titre, [{ type: 'html', text: 'Où placer le point?' }],
    [{ label: 'Annuler', value: null }, { label: 'Centre de la carte', value: 'centre' }, { label: 'Ma position GPS', value: 'gps', primary: true }]);
  if (!r) return null;
  if (r._btn === 'gps') {
    if (!lastPos) { startGps(); toast('En attente du GPS… réessaie dans quelques secondes.'); return null; }
    return lastPos.slice();
  }
  setView('carte'); crosshair(true);
  const ok = await dialogFlottant('Place la croix sur l\'endroit voulu, puis confirme.', 'Confirmer la position');
  crosshair(false);
  if (!ok) return null;
  const c = map.getCenter(); return [+c.lng.toFixed(6), +c.lat.toFixed(6)];
}
function dialogFlottant(texte, label) {
  return new Promise((resolve) => {
    const bar = $('float-bar'); bar.querySelector('span').textContent = texte;
    const [non, oui] = bar.querySelectorAll('button'); oui.textContent = label;
    bar.hidden = false;
    non.onclick = () => { bar.hidden = true; resolve(false); };
    oui.onclick = () => { bar.hidden = true; resolve(true); };
  });
}

/* ---------- Points ---------- */
async function editerPoint(p, pos) {
  const nouveau = !p;
  const r = await dialog(nouveau ? 'Nouveau point' : 'Modifier le point', [
    { name: 'nom', label: 'Nom', required: true, value: p ? p.nom : '' },
    { name: 'type', label: 'Type', type: 'select', options: TYPES_POINT, value: p ? p.type : 'cache' },
    { name: 'note', label: 'Note', value: p ? p.note : '', placeholder: 'Accès, orientation du vent, consignes…' },
    { name: 'visibilite', label: 'Visible pour', type: 'select', options: { tous: 'Tous les invités', master: 'Moi seulement' }, value: p ? p.visibilite : 'tous' },
  ], nouveau ? undefined : [{ label: 'Supprimer', value: 'suppr', danger: true }, { label: 'Déplacer', value: 'move' }, { label: 'Annuler', value: null }, { label: 'Enregistrer', value: 'ok', primary: true }]);
  if (!r) return;
  if (r._btn === 'suppr') { if (await confirmer('Supprimer « ' + p.nom + ' » ?')) queue({ type: 'point', id: p.id, supprimer: true }); return; }
  let lon = p ? p.lon : pos[0], lat = p ? p.lat : pos[1];
  if (r._btn === 'move') { const np = await choisirPosition('Déplacer « ' + p.nom + ' »'); if (!np) return; [lon, lat] = np; }
  queue({ type: 'point', id: p ? p.id : uid('p'), data: { nom: r.nom, type: r.type, note: r.note, visibilite: r.visibilite, lon, lat } });
  toast('Point enregistré.');
}
async function ajouterPoint() { const pos = await choisirPosition('Nouveau point'); if (pos) editerPoint(null, pos); }
async function confirmer(texte) {
  const r = await dialog('Confirmer', [{ type: 'html', text: texte }], [{ label: 'Annuler', value: null }, { label: 'Confirmer', value: 'ok', danger: true }]);
  return !!r;
}

/* ---------- Enregistrement d'un tracé ---------- */
window.recording = null;
let recTimer = null;
function startRecording() {
  if (window.recording) { setView('carte'); return; }
  const draft = store.get('recDraft');
  window.recording = draft && draft.coords.length ? draft : { coords: [], start: Date.now(), paused: false, dur: 0, lastTick: Date.now() };
  window.recording.lastTick = Date.now();
  startGps(); keepAwake(true); setView('carte');
  $('panel-retour').hidden = true; $('rec-panel').hidden = false;
  recTimer = setInterval(majRec, 1000); majRec();
  toast(draft ? 'Enregistrement repris.' : 'Enregistrement démarré. Garde l\'écran allumé.');
}
function onRecPos(pos) {
  const r = window.recording; if (!r || r.paused) return;
  if (pos.coords.accuracy > 35) return;
  const p = [+pos.coords.longitude.toFixed(6), +pos.coords.latitude.toFixed(6)];
  const last = r.coords[r.coords.length - 1];
  if (last && dist(last, p) < 4) return;
  r.coords.push(p);
  if (r.coords.length % 10 === 0) store.set('recDraft', r);
  majRec();
}
function majRec() {
  const r = window.recording; if (!r) return;
  if (!r.paused) { r.dur += Date.now() - r.lastTick; } r.lastTick = Date.now();
  const s = Math.floor(r.dur / 1000);
  $('rec-dist').textContent = fmtDist(lineLength(r.coords));
  $('rec-time').textContent = String(Math.floor(s / 3600)).padStart(2, '0') + ':' + String(Math.floor(s / 60) % 60).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  $('rec-acc').textContent = lastAcc ? '±' + Math.round(lastAcc) + ' m' : '—';
  $('rec-pause').textContent = r.paused ? 'REPRENDRE' : 'PAUSE';
  $('rec-state').textContent = r.paused ? 'EN PAUSE' : 'REC';
  if (r.coords.length > 1) setSelection([{ type: 'Feature', properties: { color: '#FF7A2E' }, geometry: { type: 'LineString', coordinates: r.coords } }]);
}
async function finirRecording() {
  const r = window.recording; if (!r) return;
  r.paused = true; majRec();
  if (r.coords.length < 2) {
    if (await confirmer('Le tracé est vide. Abandonner l\'enregistrement?')) stopRec();
    else { r.paused = false; }
    return;
  }
  const res = await dialog('Enregistrer le tracé (' + fmtDist(lineLength(r.coords)) + ')', [
    { name: 'nom', label: 'Nom du tracé', required: true, placeholder: 'Ex. : Sentier de la crête' },
    { name: 'type', label: 'Type', type: 'select', options: { sentier: 'Sentier (VTT / marche)', pied: 'À pied seulement', acces: 'Chemin d\'accès' } },
    { name: 'visibilite', label: 'Visible pour', type: 'select', options: { tous: 'Tous les invités', master: 'Moi seulement' } },
  ], [{ label: 'Abandonner', value: 'jeter', danger: true }, { label: 'Continuer', value: null }, { label: 'Enregistrer', value: 'ok', primary: true }]);
  if (!res) { r.paused = false; majRec(); return; }
  if (res._btn === 'jeter') { if (await confirmer('Abandonner ce tracé? Il sera perdu.')) stopRec(); else { r.paused = false; } return; }
  queue({ type: 'trace', id: uid('t'), data: { nom: res.nom, type: res.type, visibilite: res.visibilite, coords: simplify(r.coords, 3) } });
  stopRec(); toast('Tracé enregistré.'); prefetchTraceTiles();
}
function stopRec() {
  window.recording = null; store.set('recDraft', null); clearInterval(recTimer);
  $('rec-panel').hidden = true; $('panel-retour').hidden = false; setSelection([]);
  if (!guiding) keepAwake(false);
}

/* ---------- Dessiner un tracé point par point ---------- */
let drawing = null;
function majDessin() {
  const c = drawing.coords;
  $('draw-dist').textContent = fmtDist(lineLength(c));
  $('draw-n').textContent = c.length;
  const f = [];
  if (c.length > 1) f.push({ type: 'Feature', properties: { color: '#FF7A2E' }, geometry: { type: 'LineString', coordinates: c } });
  c.forEach((p) => f.push({ type: 'Feature', properties: { color: '#FFFFFF' }, geometry: { type: 'LineString', coordinates: [p, [p[0] + 0.00001, p[1]]] } }));
  setSelection(f);
}
function commencerDessin() {
  if (window.recording) { toast('Termine d\'abord l\'enregistrement en cours.'); return; }
  drawing = { coords: [] };
  setView('carte'); setSatellite(true);
  $('panel-retour').hidden = true; $('sec-panel').hidden = true; $('draw-panel').hidden = false;
  hooks.onMapClick = (e) => { drawing.coords.push([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]); majDessin(); };
  majDessin(); toast('Touche la carte pour placer chaque point du chemin.');
}
function finDessin() { drawing = null; hooks.onMapClick = null; $('draw-panel').hidden = true; $('panel-retour').hidden = false; setSelection([]); }
async function terminerDessin() {
  if (!drawing || drawing.coords.length < 2) { toast('Place au moins deux points.'); return; }
  const res = await dialog('Enregistrer le tracé dessiné (' + fmtDist(lineLength(drawing.coords)) + ')', [
    { name: 'nom', label: 'Nom', required: true, placeholder: 'Ex. : Chemin du KM 66 au chalet' },
    { name: 'type', label: 'Type', type: 'select', options: { sentier: 'Sentier (VTT / marche)', pied: 'À pied seulement', acces: 'Chemin d\'accès', zone: 'Zone / territoire (contour fermé)' } },
    { name: 'visibilite', label: 'Visible pour', type: 'select', options: { tous: 'Tous les invités', master: 'Moi seulement' } },
  ]);
  if (!res) return;
  queue({ type: 'trace', id: uid('t'), data: { nom: res.nom, type: res.type, visibilite: res.visibilite, coords: drawing.coords } });
  finDessin(); toast('Tracé enregistré.'); prefetchTraceTiles();
}

/* ---------- Satellite hors ligne (zone affichée) ---------- */
async function garderSatellite() {
  if (!navigator.onLine) { toast('Il faut du réseau pour télécharger le satellite.'); return; }
  const b = map.getBounds(), z0 = Math.max(12, Math.floor(map.getZoom()) - 2), urls = [];
  for (let z = z0; z <= 17; z++) {
    for (let x = lon2x(b.getWest(), z); x <= lon2x(b.getEast(), z); x++) for (let y = lat2y(b.getNorth(), z); y <= lat2y(b.getSouth(), z); y++) urls.push(SAT_TILES.replace('{z}', z).replace('{x}', x).replace('{y}', y));
  }
  if (urls.length > 3000) { toast('Zone trop grande (' + urls.length + ' tuiles) : rapproche-toi avant de télécharger.'); return; }
  if (!(await confirmer('Garder le satellite de cette zone hors ligne? (' + urls.length + ' tuiles, environ ' + Math.round(urls.length * 0.02) + ' Mo)'))) return;
  toast('Téléchargement du satellite…');
  const cache = await caches.open('satellite-v1'); let i = 0, done = 0;
  const worker = async () => { while (i < urls.length) { const u = urls[i++]; try { if (!(await cache.match(u))) { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await cache.put(u, r); } } catch (e) {} done++; } };
  await Promise.all(Array.from({ length: 6 }, worker));
  toast('Satellite gardé hors ligne pour cette zone.');
}

/* ---------- Import GPX / KML ---------- */
async function importerFichier(file) {
  const txt = await file.text();
  const xml = new DOMParser().parseFromString(txt, 'application/xml');
  const traces = [], points = [];
  const num = (el, a) => parseFloat(el.getAttribute(a));
  xml.querySelectorAll('trk, rte').forEach((t, i) => {
    const pts = Array.from(t.querySelectorAll('trkpt, rtept')).map((p) => [num(p, 'lon'), num(p, 'lat')]).filter((p) => !isNaN(p[0]));
    const nom = (t.querySelector(':scope > name') || {}).textContent || file.name.replace(/\.\w+$/, '') + (i ? ' ' + (i + 1) : '');
    if (pts.length > 1) traces.push({ nom, coords: pts });
  });
  xml.querySelectorAll('wpt').forEach((w) => { points.push({ nom: (w.querySelector('name') || {}).textContent || 'Point', lon: num(w, 'lon'), lat: num(w, 'lat') }); });
  xml.querySelectorAll('Placemark').forEach((pm) => {
    const nom = (pm.querySelector('name') || {}).textContent || 'Élément';
    const parse = (s) => s.trim().split(/\s+/).map((c) => c.split(',').map(Number)).map((c) => [c[0], c[1]]);
    const ls = pm.querySelector('LineString > coordinates'); const pt = pm.querySelector('Point > coordinates');
    const gx = Array.from(pm.getElementsByTagName('gx:coord')).map((c) => c.textContent.trim().split(/\s+/).map(Number)).map((c) => [c[0], c[1]]);
    if (ls) traces.push({ nom, coords: parse(ls.textContent) });
    else if (gx.length > 1) traces.push({ nom, coords: gx });
    else if (pt) { const c = parse(pt.textContent)[0]; points.push({ nom, lon: c[0], lat: c[1] }); }
  });
  if (!traces.length && !points.length) { toast('Aucun tracé ni point trouvé dans ce fichier.'); return; }
  const r = await dialog('Importer « ' + file.name + ' »', [
    { type: 'html', text: traces.length + ' tracé(s) et ' + points.length + ' point(s) trouvés.' },
    { name: 'type', label: 'Type des tracés', type: 'select', options: { sentier: 'Sentier (VTT / marche)', pied: 'À pied seulement', acces: 'Chemin d\'accès' } },
    { name: 'visibilite', label: 'Visible pour', type: 'select', options: { tous: 'Tous les invités', master: 'Moi seulement' } },
  ], [{ label: 'Annuler', value: null }, { label: 'Importer', value: 'ok', primary: true }]);
  if (!r) return;
  traces.forEach((t) => queue({ type: 'trace', id: uid('t'), data: { nom: t.nom, type: r.type, visibilite: r.visibilite, coords: simplify(t.coords, 3) } }));
  points.forEach((p) => queue({ type: 'point', id: uid('p'), data: { nom: p.nom, type: 'lieu', note: '', visibilite: r.visibilite, lon: +p.lon.toFixed(6), lat: +p.lat.toFixed(6) } }));
  toast('Import terminé.'); prefetchTraceTiles();
}

/* ---------- Modifier / supprimer une section de tracé ---------- */
let secTrace = null;
const traceSous = (e) => {
  const b = 14;
  const fs = map.queryRenderedFeatures([[e.point.x - b, e.point.y - b], [e.point.x + b, e.point.y + b]], { layers: ['sentiers', 'pied', 'acces', 'zone-ligne'] });
  const f = fs.find((x) => x.properties.id);
  if (f) return dyn.traces.find((t) => t.id === f.properties.id);
  if (fs.some((x) => x.properties.kind === 'zone')) {
    const z = base.features.find((x) => x.properties.kind === 'zone');
    if (z) { const c = z.geometry.coordinates[0].map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]); return { id: null, nom: 'Territoire de chasse', type: 'zone', visibilite: 'tous', coords: c }; }
  }
  return null;
};
// Toucher un tracé en mode Master : renommer, changer le type, modifier les points, supprimer
async function actionsTrace(t) {
  setSelection([{ type: 'Feature', properties: { color: '#FF4D3D' }, geometry: { type: 'LineString', coordinates: t.type === 'zone' ? ferme(t.coords) : t.coords } }]);
  const r = await dialog((t.type === 'zone' ? 'Zone : ' : 'Tracé : ') + t.nom + ' (' + fmtDist(lineLength(t.coords)) + ')', [
    { name: 'nom', label: 'Nom', required: true, value: t.nom },
    { name: 'type', label: 'Type', type: 'select', options: { sentier: 'Sentier (VTT / marche)', pied: 'À pied seulement', acces: 'Chemin d\'accès', zone: 'Zone / territoire (contour fermé)' }, value: t.type },
    { name: 'visibilite', label: 'Visible pour', type: 'select', options: { tous: 'Tous les invités', master: 'Moi seulement' }, value: t.visibilite || 'tous' },
  ], [
    { label: 'Supprimer', value: 'suppr', danger: true },
    { label: 'Modifier les points', value: 'points' },
  ].concat(t.type === 'zone' ? [] : [{ label: 'Une section…', value: 'section' }]).concat([
    { label: 'Annuler', value: null },
    { label: 'Enregistrer', value: 'ok', primary: true },
  ]));
  setSelection([]);
  if (!r) return;
  if (!t.id) { t = Object.assign({}, t, { id: uid('t') }); queue({ type: 'trace', id: t.id, data: { nom: t.nom, type: 'zone', visibilite: 'tous', coords: t.coords } }); }
  if (r._btn === 'suppr') { if (await confirmer('Supprimer « ' + t.nom + ' » ?')) { queue({ type: 'trace', id: t.id, supprimer: true }); toast('Supprimé.'); } return; }
  const maj = { nom: r.nom, type: r.type, visibilite: r.visibilite };
  const change = maj.nom !== t.nom || maj.type !== t.type || maj.visibilite !== (t.visibilite || 'tous');
  if (change) queue({ type: 'trace', id: t.id, data: Object.assign({}, maj, { coords: t.coords }) });
  const t2 = Object.assign({}, t, maj);
  if (r._btn === 'points') editerPoints(t2);
  else if (r._btn === 'section') ouvrirSection(t2);
  else if (change) toast('Tracé modifié.');
}

/* ---------- Modifier les points d'un tracé ---------- */
let edit = null;
function editerPoints(t) {
  let coords = t.coords;
  if (coords.length > 200) coords = simplify(coords, 4);
  if (coords.length > 200) coords = simplify(coords, 10);
  const zone = t.type === 'zone';
  if (zone && coords.length > 2 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1]) coords = coords.slice(0, -1);
  edit = { trace: t, coords: coords.map((c) => c.slice()), markers: [], sel: -1, zone };
  setView('carte'); fitTrace(t); setSatellite(true);
  $('panel-retour').hidden = true; $('sec-panel').hidden = true; $('edit-panel').hidden = false;
  hooks.onMapClick = (e) => ajouterSommet([+e.lngLat.lng.toFixed(6), +e.lngLat.lat.toFixed(6)]);
  dessinerSommets();
  toast('Glisse un point pour le déplacer, touche la carte pour en ajouter.');
}
function dessinerSommets() {
  edit.markers.forEach((m) => m.remove()); edit.markers = [];
  edit.coords.forEach((c, i) => {
    const el = document.createElement('div'); el.className = 'vx' + (i === edit.sel ? ' sel' : '');
    const m = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(c).addTo(map);
    m.on('drag', () => { const p = m.getLngLat(); edit.coords[i] = [+p.lng.toFixed(6), +p.lat.toFixed(6)]; majEdit(); });
    el.addEventListener('click', (ev) => { ev.stopPropagation(); edit.sel = i; dessinerSommets(); });
    edit.markers.push(m);
  });
  majEdit();
}
function majEdit() {
  setSelection([{ type: 'Feature', properties: { color: '#FF7A2E' }, geometry: { type: 'LineString', coordinates: edit.zone ? ferme(edit.coords) : edit.coords } }]);
  $('edit-info').textContent = edit.coords.length + ' points · ' + fmtDist(lineLength(edit.coords)) + (edit.sel >= 0 ? ' · point ' + (edit.sel + 1) + ' sélectionné' : '');
  $('edit-del').disabled = edit.sel < 0;
}
function ajouterSommet(p) {
  const c = edit.coords, k = Math.cos(rad(p[1])) * 111320, M = 111320;
  let best = { d: Infinity, i: c.length, t: 1 };
  const nseg = edit.zone ? c.length : c.length - 1;
  for (let i = 0; i < nseg; i++) {
    const j = (i + 1) % c.length;
    const ax = c[i][0] * k, ay = c[i][1] * M, bx = c[j][0] * k, by = c[j][1] * M, px = p[0] * k, py = p[1] * M;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / L2; const tc = Math.max(0, Math.min(1, t));
    const d = Math.hypot(px - (ax + tc * dx), py - (ay + tc * dy));
    if (d < best.d) best = { d, i, t };
  }
  if (edit.zone) { c.splice(best.i + 1, 0, p); edit.sel = best.i + 1; }
  else if (best.i === 0 && best.t < 0) { c.unshift(p); edit.sel = 0; }
  else if (best.i === c.length - 2 && best.t > 1) { c.push(p); edit.sel = c.length - 1; }
  else { c.splice(best.i + 1, 0, p); edit.sel = best.i + 1; }
  dessinerSommets();
}
function retirerSommet() {
  if (!edit || edit.sel < 0) return;
  if (edit.coords.length <= (edit.zone ? 3 : 2)) { toast(edit.zone ? 'Une zone doit garder au moins 3 points.' : 'Un tracé doit garder au moins 2 points.'); return; }
  edit.coords.splice(edit.sel, 1); edit.sel = -1; dessinerSommets();
}
function finEdit() {
  if (!edit) return;
  edit.markers.forEach((m) => m.remove()); edit = null;
  hooks.onMapClick = null; $('edit-panel').hidden = true; $('panel-retour').hidden = false; setSelection([]);
}
function sauverEdit() {
  const t = edit.trace; if (!t.id) t.id = uid('t');
  queue({ type: 'trace', id: t.id, data: { nom: t.nom, type: t.type, visibilite: t.visibilite || 'tous', coords: edit.coords } });
  finEdit(); toast('Tracé modifié.'); prefetchTraceTiles();
}

function choisirTrace() {
  setView('carte'); toast('Touche le tracé à modifier sur la carte.');
  hooks.onMapClick = (e) => {
    const b = 14, f = map.queryRenderedFeatures([[e.point.x - b, e.point.y - b], [e.point.x + b, e.point.y + b]], { layers: ['sentiers', 'pied', 'acces'] })
      .find((x) => x.properties.id);
    if (!f) { toast('Aucun tracé modifiable ici. Touche une ligne orange.'); return; }
    hooks.onMapClick = null;
    ouvrirSection(dyn.traces.find((t) => t.id === f.properties.id));
  };
}
function ouvrirSection(t) {
  if (!t) return;
  secTrace = t; const n = t.coords.length - 1;
  const a = $('sec-a'), b = $('sec-b');
  a.max = b.max = n; a.value = Math.round(n * 0.4); b.value = Math.round(n * 0.6);
  $('sec-nom').textContent = t.nom; $('panel-retour').hidden = true; $('sec-panel').hidden = false;
  majSection();
}
function majSection() {
  const t = secTrace; if (!t) return;
  let a = +$('sec-a').value, b = +$('sec-b').value; if (a > b) [a, b] = [b, a];
  const part = t.coords.slice(a, b + 1);
  $('sec-len').textContent = fmtDist(lineLength(part)) + ' sur ' + fmtDist(lineLength(t.coords));
  setSelection([
    { type: 'Feature', properties: { color: '#E8E6DC' }, geometry: { type: 'LineString', coordinates: t.coords } },
    { type: 'Feature', properties: { color: '#FF4D3D' }, geometry: { type: 'LineString', coordinates: part.length > 1 ? part : t.coords.slice(a, a + 2) } },
  ]);
}
function fermerSection() { secTrace = null; $('sec-panel').hidden = true; $('panel-retour').hidden = false; setSelection([]); }
async function actionSection(kind) {
  const t = secTrace; if (!t) return;
  let a = +$('sec-a').value, b = +$('sec-b').value; if (a > b) [a, b] = [b, a];
  const avant = t.coords.slice(0, a + 1), milieu = t.coords.slice(a, b + 1), apres = t.coords.slice(b);
  if (kind === 'tout') {
    if (!(await confirmer('Supprimer tout le tracé « ' + t.nom + ' » ?'))) return;
    queue({ type: 'trace', id: t.id, supprimer: true }); fermerSection(); toast('Tracé supprimé.'); return;
  }
  if (kind === 'suppr' && !(await confirmer('Supprimer la section rouge (' + fmtDist(lineLength(milieu)) + ') ?'))) return;
  const base = { nom: t.nom, type: t.type, visibilite: t.visibilite };
  queue({ type: 'trace', id: t.id, supprimer: true });
  if (avant.length > 1) queue({ type: 'trace', id: uid('t'), data: Object.assign({}, base, { coords: avant }) });
  if (apres.length > 1) queue({ type: 'trace', id: uid('t'), data: Object.assign({}, base, { coords: apres }) });
  if (kind === 'prive') queue({ type: 'trace', id: uid('t'), data: Object.assign({}, base, { visibilite: 'master', coords: milieu }) });
  if (kind === 'pied') queue({ type: 'trace', id: uid('t'), data: Object.assign({}, base, { type: 'pied', coords: milieu }) });
  fermerSection(); toast(kind === 'suppr' ? 'Section supprimée.' : 'Section modifiée.');
}

/* ---------- Repères du guidage ---------- */
async function editerRepere(rp) {
  let pos = rp ? [rp.lon, rp.lat] : await choisirPosition('Nouveau repère de guidage');
  if (!pos) return;
  const s = snapToRoute(pos);
  const r = await dialog(rp ? 'Modifier le repère' : 'Nouveau repère', [
    { type: 'html', text: 'À ' + fmtDist(s.along) + ' du départ' + (s.d > 300 ? ' — attention : ' + fmtDist(s.d) + ' de la route' : '') + '.' },
    { name: 'nom', label: 'Nom', required: true, value: rp ? rp.nom : '', placeholder: 'Ex. : Pont de la rivière' },
    { name: 'consigne', label: 'Consigne', required: true, value: rp ? rp.consigne : '', placeholder: 'Ex. : Tournez à droite.' },
  ], rp ? [{ label: 'Supprimer', value: 'suppr', danger: true }, { label: 'Annuler', value: null }, { label: 'Enregistrer', value: 'ok', primary: true }] : undefined);
  if (!r) return;
  if (r._btn === 'suppr') { if (await confirmer('Supprimer le repère « ' + rp.nom + ' » ?')) queue({ type: 'repere', id: rp.id, supprimer: true }); return; }
  queue({ type: 'repere', id: rp ? rp.id : uid('r'), data: { km: Math.round(s.along / 10) / 100, nom: r.nom, consigne: r.consigne, lon: +pos[0].toFixed(6), lat: +pos[1].toFixed(6) } });
}

/* ---------- Livre : approbation ---------- */
function masterHistoireActions(h) {
  const d = document.createElement('div'); d.className = 'story-actions';
  const a = document.createElement('button'); a.type = 'button'; a.className = 'btn-sm';
  a.textContent = h.approuve ? 'Retirer du livre' : 'Approuver';
  a.onclick = () => queue({ type: 'histoire', id: h.id, data: { approuve: !h.approuve } });
  const s = document.createElement('button'); s.type = 'button'; s.className = 'btn-sm danger'; s.textContent = 'Supprimer';
  s.onclick = async () => { if (await confirmer('Supprimer cette histoire?')) queue({ type: 'histoire', id: h.id, supprimer: true }); };
  d.append(a, s); return d;
}

/* ---------- Écran Master ---------- */
function ligne(texte, sous, onclick) {
  const li = document.createElement('li'); const b = document.createElement('button'); b.type = 'button'; b.className = 'm-item';
  const t = document.createElement('b'); t.textContent = texte; const s = document.createElement('span'); s.className = 'muted small'; s.textContent = sous;
  b.append(t, s); b.onclick = onclick; li.appendChild(b); return li;
}
function renderMaster() {
  if (!window.masterNip || !dyn) return;
  renderSyncState();
  const lp = $('m-points'); lp.innerHTML = '';
  dyn.points.slice().sort((a, b) => a.nom.localeCompare(b.nom)).forEach((p) =>
    lp.appendChild(ligne(p.nom, (TYPES_POINT[p.type] || p.type) + (p.visibilite === 'master' ? ' · privé' : ''), () => editerPoint(p))));
  const lt = $('m-traces'); lt.innerHTML = '';
  dyn.traces.forEach((t) => lt.appendChild(ligne(t.nom, fmtDist(lineLength(t.coords)) + ' · ' + t.type + (t.visibilite === 'master' ? ' · privé' : ''), () => { setView('carte'); fitTrace(t); ouvrirSection(t); })));
  const lr = $('m-reperes'); lr.innerHTML = '';
  reperesTries().forEach((r) => lr.appendChild(ligne(r.km.toFixed(1).replace('.', ',') + ' km — ' + r.nom, r.consigne, () => editerRepere(r))));
  const att = (dyn.histoires || []).filter((h) => !h.approuve).length;
  $('m-livre').textContent = att ? att + ' histoire' + (att > 1 ? 's' : '') + ' à approuver' : 'Aucune histoire en attente';
}
function fitTrace(t) {
  const lons = t.coords.map((c) => c[0]), lats = t.coords.map((c) => c[1]);
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 60, duration: 500 });
}

function initMaster() {
  // Appui long (0,8 s) sur le logo pour ouvrir le mode Master
  const logo = document.querySelector('.tb-logo'); let t;
  const down = (e) => { t = setTimeout(demanderNip, 800); };
  const up = () => clearTimeout(t);
  logo.addEventListener('touchstart', down, { passive: true }); logo.addEventListener('mousedown', down);
  ['touchend', 'touchmove', 'mouseup', 'mouseleave'].forEach((ev) => logo.addEventListener(ev, up));
  logo.addEventListener('contextmenu', (e) => e.preventDefault());

  $('m-quit').onclick = quitterMaster;
  $('m-sync-btn').onclick = syncMaster;
  $('m-rec').onclick = startRecording;
  $('m-gpx').onclick = () => $('m-gpx-file').click();
  $('m-draw').onclick = commencerDessin;
  $('edit-del').onclick = retirerSommet;
  $('edit-cancel').onclick = finEdit;
  $('edit-save').onclick = sauverEdit;
  hooks.onMapClickDefault = (e) => {
    if (!window.masterNip || drawing || edit || window.recording || secTrace) return;
    const t = traceSous(e); if (t) actionsTrace(t);
  };
  $('draw-undo').onclick = () => { if (drawing) { drawing.coords.pop(); majDessin(); } };
  $('draw-cancel').onclick = async () => { if (!drawing.coords.length || await confirmer('Abandonner ce dessin?')) finDessin(); };
  $('draw-done').onclick = terminerDessin;
  $('btn-sat').onclick = () => { setSatellite(!satOn); $('btn-sat-dl').hidden = !satOn; };
  $('btn-sat-dl').onclick = garderSatellite;
  $('m-gpx-file').onchange = (e) => { const f = e.target.files[0]; if (f) importerFichier(f); e.target.value = ''; };
  $('m-section').onclick = choisirTrace;
  $('m-add-point').onclick = ajouterPoint;
  $('m-add-repere').onclick = () => editerRepere(null);
  $('m-voir-livre').onclick = () => setView('livre');
  $('rec-pause').onclick = () => { const r = window.recording; if (r) { r.paused = !r.paused; majRec(); store.set('recDraft', r); } };
  $('rec-stop').onclick = finirRecording;
  $('rec-point').onclick = () => { if (lastPos) editerPoint(null, lastPos.slice()); else toast('En attente du GPS…'); };
  $('sec-a').oninput = majSection; $('sec-b').oninput = majSection;
  $('sec-suppr').onclick = () => actionSection('suppr');
  $('sec-prive').onclick = () => actionSection('prive');
  $('sec-pied').onclick = () => actionSection('pied');
  $('sec-tout').onclick = () => actionSection('tout');
  $('sec-fermer').onclick = fermerSection;
  hooks.onPos.push(onRecPos);
  hooks.onData.push((why) => { renderMaster(); if (why === 'online') syncMaster(); });
  // En mode Master, toucher un point l'ouvre en modification
  const prev = hooks.onMarker;
  hooks.onMarker = (p) => { if (window.masterNip) { editerPoint(p); return true; } return prev ? prev(p) : false; };
  if (store.get('recDraft')) toast('Un enregistrement a été interrompu. Entre en mode Master pour le reprendre.');
}
