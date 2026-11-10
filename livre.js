/* Le livre du Doré Noir — histoires et photos des invités */
'use strict';

/* --- IndexedDB : file d'envoi (photos comprises) --- */
const idb = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((ok, ko) => {
      const r = indexedDB.open('dore-noir', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('envois', { keyPath: 'id' });
      r.onsuccess = () => { this.db = r.result; ok(this.db); };
      r.onerror = () => ko(r.error);
    });
  },
  async tx(mode, fn) {
    const db = await this.open();
    return new Promise((ok, ko) => {
      const t = db.transaction('envois', mode); const s = t.objectStore('envois'); const req = fn(s);
      t.oncomplete = () => ok(req && req.result); t.onerror = () => ko(t.error);
    });
  },
  put(o) { return this.tx('readwrite', (s) => s.put(o)); },
  del(id) { return this.tx('readwrite', (s) => s.delete(id)); },
  all() { return this.tx('readonly', (s) => s.getAll()); },
};

const CATS = { tout: 'Tout', peche: 'Pêche', chasse: 'Chasse', chalet: 'Chalet' };
let filtreLivre = 'tout';

function compressImage(file, max = 1600, q = 0.75) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file); const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); ko(new Error('image illisible')); };
    img.src = url;
  });
}

const aujourdhui = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
function fmtDate(iso) {
  try {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(iso);
    return d.toLocaleDateString('fr-CA', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return ''; }
}

async function renderLivre() {
  const list = $('livre-list'); if (!list) return;
  const envois = await idb.all().catch(() => []);
  const items = envois.map((e) => Object.assign({}, e, { enAttente: true, photos: e.photos || [] }))
    .concat((dyn.histoires || []).filter((h) => h.approuve !== false || window.masterNip))
    .filter((h) => filtreLivre === 'tout' || h.categorie === filtreLivre)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  list.innerHTML = '';
  if (!items.length) {
    list.innerHTML = '<div class="card"><strong class="cond">Le livre est vide… pour l\'instant</strong><p class="small">Sois le premier à raconter ton séjour au Domaine!</p></div>';
  }
  items.forEach((h) => {
    const art = document.createElement('article'); art.className = 'story';
    if (h.photos.length) {
      const ph = document.createElement('div'); ph.className = 'story-photos ' + (h.photos.length === 1 ? 'une' : 'collage');
      h.photos.forEach((src, i) => {
        const pr = document.createElement('figure'); pr.className = 'print';
        pr.style.setProperty('--r', angle(String(h.id || h.date) + i) + 'deg');
        pr.style.zIndex = String(1 + ((i * 7) % 5));
        pr.innerHTML = '<span class="tape t1"></span><span class="tape t2"></span>' + (h.photos.length === 1 ? '<span class="tape t3"></span><span class="tape t4"></span>' : '');
        const im = document.createElement('img'); im.loading = 'lazy'; im.alt = ''; im.src = src;
        pr.prepend(im); pr.onclick = () => openPhoto(h.photos, i); ph.appendChild(pr);
      });
      art.appendChild(ph);
    }
    const body = document.createElement('div'); body.className = 'story-body';
    const meta = document.createElement('div'); meta.className = 'row-between';
    const m1 = document.createElement('span'); m1.className = 'mono muted xsmall'; m1.textContent = 'SÉJOUR DU ' + fmtDate(h.date).toUpperCase() + ' · PAR ' + String(h.auteur || '').toUpperCase();
    const m2 = document.createElement('span'); m2.className = 'tag ' + (h.categorie || 'chalet'); m2.textContent = h.enAttente ? 'EN ATTENTE D\'ENVOI' : h.approuve === false ? 'À APPROUVER' : (CATS[h.categorie] || 'Chalet').toUpperCase();
    meta.append(m1, m2); body.appendChild(meta);
    if (h.titre) { const t = document.createElement('h3'); t.className = 'cond'; t.textContent = h.titre; body.appendChild(t); }
    if (h.texte) { const p = document.createElement('p'); p.textContent = h.texte; body.appendChild(p); }
    if (h.lon && h.lat) {
      const a = document.createElement('button'); a.type = 'button'; a.className = 'link-btn mono xsmall'; a.textContent = '◎ VOIR SUR LA CARTE';
      a.onclick = () => { setView('carte'); map.easeTo({ center: [h.lon, h.lat], zoom: 15 }); };
      body.appendChild(a);
    }
    if (window.masterNip && !h.enAttente && typeof masterHistoireActions === 'function') body.appendChild(masterHistoireActions(h));
    art.appendChild(body); list.appendChild(art);
  });
  const n = envois.length;
  $('livre-pending').hidden = !n;
  $('livre-pending').textContent = n + (n > 1 ? ' histoires attendent' : ' histoire attend') + ' le réseau pour être envoyée' + (n > 1 ? 's' : '') + '.';
}

// Angle « photo papier » : différent pour chaque image, toujours le même pour la même image
function angle(cle) {
  let x = 0; for (const c of cle) x = (x * 31 + c.charCodeAt(0)) | 0;
  const a = ((Math.abs(x) % 70) / 10) - 3.5; // -3,5° à +3,5°
  return Math.abs(a) < 1 ? (a < 0 ? a - 1.2 : a + 1.2) : a;
}
let vue = { photos: [], i: 0 };
function openPhoto(photos, i = 0) {
  vue = { photos: Array.isArray(photos) ? photos : [photos], i };
  const v = $('photo-view'); majVue(); v.hidden = false;
}
function majVue() {
  const v = $('photo-view'), n = vue.photos.length;
  v.querySelector('img').src = vue.photos[vue.i];
  v.querySelector('.pv-prec').hidden = v.querySelector('.pv-suiv').hidden = n < 2;
  v.querySelector('.pv-compte').textContent = n > 1 ? (vue.i + 1) + ' / ' + n : '';
}
function pasPhoto(d) { const n = vue.photos.length; vue.i = (vue.i + d + n) % n; majVue(); }

async function ecrireHistoire() {
  const r = await dialog('Raconte ton séjour', [
    { name: 'auteur', label: 'Écrit par', required: true, placeholder: 'Ton nom ou ta famille', value: store.get('auteur') || '', autocomplete: 'name' },
    { name: 'date', label: 'Date du séjour', type: 'date', value: aujourdhui(), required: true },
    { name: 'titre', label: 'Titre', placeholder: 'Ex. : Premier doré de la saison' },
    { name: 'texte', label: 'Ton histoire', type: 'textarea', placeholder: 'Qu\'est-ce qui s\'est passé?' },
    { name: 'categorie', label: 'Catégorie', type: 'select', options: { peche: 'Pêche', chasse: 'Chasse', chalet: 'Chalet' } },
    { name: 'photos', label: 'Photos (6 max.)', type: 'file', accept: 'image/*', multiple: true },
    { name: 'gps', label: 'Épingler ma position sur la carte', type: 'checkbox', value: !!lastPos },
    { name: 'site', label: 'Site web', type: 'text', hidden: true, autocomplete: 'off' },
  ], [{ label: 'Annuler', value: null }, { label: 'Enregistrer l\'histoire', value: 'ok', primary: true }]);
  if (!r) return;
  if (!r.texte && !(r.photos && r.photos.length)) { toast('Écris un petit texte ou ajoute une photo.'); return; }
  store.set('auteur', r.auteur);
  toast('Préparation des photos…');
  const photos = [];
  for (const f of Array.from(r.photos || []).slice(0, 6)) { try { photos.push(await compressImage(f)); } catch (e) {} }
  const h = {
    id: uid('h'), date: r.date || aujourdhui(), auteur: r.auteur, titre: r.titre, texte: r.texte, categorie: r.categorie,
    lon: r.gps && lastPos ? +lastPos[0].toFixed(6) : null, lat: r.gps && lastPos ? +lastPos[1].toFixed(6) : null, photos, site: r.site,
  };
  await idb.put(h);
  toast(navigator.onLine ? 'Envoi en cours…' : 'Enregistrée : elle partira au retour du réseau.');
  renderLivre(); envoyerHistoires();
}

let envoiEnCours = false;
async function envoyerHistoires() {
  if (envoiEnCours || !navigator.onLine || !apiOk()) return;
  envoiEnCours = true;
  try {
    const envois = await idb.all();
    for (const h of envois) {
      try {
        await api(Object.assign({ action: 'histoire' }, h, { photos: h.photos.map((p) => p.split(',')[1]) }));
        await idb.del(h.id);
        toast('Histoire envoyée! Elle sera visible après approbation.');
      } catch (e) { console.warn('[DN] envoi histoire', e.message); break; }
    }
  } finally { envoiEnCours = false; renderLivre(); }
}

function initLivre() {
  const chips = $('livre-chips');
  Object.entries(CATS).forEach(([k, l]) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'chip' + (k === filtreLivre ? ' on' : ''); b.textContent = l;
    b.onclick = () => { filtreLivre = k; chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('on')); b.classList.add('on'); renderLivre(); };
    chips.appendChild(b);
  });
  $('livre-ecrire').onclick = ecrireHistoire;
  const pv = $('photo-view');
  pv.onclick = () => { if (!pv.dataset.swipe) pv.hidden = true; };
  pv.querySelector('.pv-prec').onclick = (e) => { e.stopPropagation(); pasPhoto(-1); };
  pv.querySelector('.pv-suiv').onclick = (e) => { e.stopPropagation(); pasPhoto(1); };
  let x0 = null;
  pv.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  pv.addEventListener('touchend', (e) => { if (x0 === null || vue.photos.length < 2) return; const dx = e.changedTouches[0].clientX - x0; x0 = null; if (Math.abs(dx) > 50) { pasPhoto(dx < 0 ? 1 : -1); pv.dataset.swipe = '1'; setTimeout(() => delete pv.dataset.swipe, 400); } });
  hooks.onData.push((why) => { renderLivre(); if (why === 'online') envoyerHistoires(); });
  renderLivre(); envoyerHistoires();
}
