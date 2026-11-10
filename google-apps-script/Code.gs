/**
 * Domaine du Doré Noir — serveur Google (Apps Script)
 * À coller dans : Google Sheet « Doré Noir — données » → Extensions → Apps Script.
 *
 * Feuilles : Points, Traces, Reperes, Histoires (créées automatiquement).
 * Photos du livre : dossier « Doré Noir — Photos du livre » dans ton Drive.
 * Le NIP du mode Master se définit dans la Sheet : menu Doré Noir → Définir le NIP.
 */

const SEED_URL = 'https://connex-app.github.io/dore-noir/data/seed.json';
const COLS = {
  Points:    ['id', 'nom', 'type', 'note', 'visibilite', 'lon', 'lat', 'modifie', 'supprime'],
  Traces:    ['id', 'nom', 'type', 'visibilite', 'coords', 'modifie', 'supprime'],
  Reperes:   ['id', 'km', 'nom', 'consigne', 'lon', 'lat', 'modifie', 'supprime'],
  Histoires: ['id', 'date', 'auteur', 'titre', 'texte', 'categorie', 'lon', 'lat', 'photos', 'approuve', 'supprime'],
};
const MAX_PHOTOS = 6;

/* ---------- Menu dans la Sheet ---------- */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Doré Noir')
    .addItem('1. Initialiser les données', 'initialiser')
    .addItem('2. Définir le NIP du mode Master', 'definirNip')
    .addToUi();
}

function initialiser() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(COLS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(COLS[name]);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, COLS[name].length).setFontWeight('bold');
    }
  });
  const first = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1');
  if (first && ss.getSheets().length > 1 && first.getLastRow() === 0) ss.deleteSheet(first);
  dossierPhotos_();

  const seed = JSON.parse(UrlFetchApp.fetch(SEED_URL).getContentText());
  const now = new Date().toISOString();
  let added = 0;
  if (ss.getSheetByName('Points').getLastRow() <= 1) {
    seed.points.forEach((p) => { ecrire_('Points', Object.assign({ modifie: now, supprime: false }, p)); added++; });
  }
  if (ss.getSheetByName('Traces').getLastRow() <= 1) {
    seed.traces.forEach((t) => { ecrire_('Traces', Object.assign({ modifie: now, supprime: false }, t, { coords: JSON.stringify(t.coords) })); added++; });
  }
  if (ss.getSheetByName('Reperes').getLastRow() <= 1) {
    seed.reperes.forEach((r) => { ecrire_('Reperes', Object.assign({ modifie: now, supprime: false }, r)); added++; });
  }
  const h = ss.getSheetByName('Histoires');
  h.getRange(2, COLS.Histoires.indexOf('approuve') + 1, 500, 1).insertCheckboxes();
  SpreadsheetApp.getUi().alert('Données prêtes : ' + added + ' éléments ajoutés.');
}

function definirNip() {
  const ui = SpreadsheetApp.getUi();
  const r = ui.prompt('NIP du mode Master', 'Choisis un NIP de 4 à 8 chiffres (garde-le pour toi) :', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  const nip = r.getResponseText().trim();
  if (!/^\d{4,8}$/.test(nip)) { ui.alert('Le NIP doit contenir de 4 à 8 chiffres.'); return; }
  PropertiesService.getScriptProperties().setProperty('NIP_HASH', hash_(nip));
  ui.alert('NIP enregistré.');
}

/* ---------- Outils ---------- */
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'dore-noir:' + s)
    .map((b) => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function sheet_(name) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name); }
function lire_(name) {
  const sh = sheet_(name); const v = sh.getDataRange().getValues(); const head = v.shift();
  return v.filter((row) => row[0] !== '').map((row) => { const o = {}; head.forEach((h, i) => { o[h] = row[i]; }); return o; });
}
function ecrire_(name, obj) {
  const sh = sheet_(name); const head = COLS[name];
  const ids = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
  const i = ids.indexOf(String(obj.id));
  if (i === -1) {
    sh.appendRow(head.map((h) => (obj[h] === undefined ? '' : obj[h])));
  } else {
    const range = sh.getRange(i + 2, 1, 1, head.length); const cur = range.getValues()[0];
    range.setValues([head.map((h, k) => (obj[h] === undefined ? cur[k] : obj[h]))]);
  }
}
function dossierPhotos_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const f = DriveApp.createFolder('Doré Noir — Photos du livre');
  props.setProperty('FOLDER_ID', f.getId());
  return f;
}
function nipOk_(pin) {
  const cache = CacheService.getScriptCache();
  const essais = Number(cache.get('essais') || 0);
  if (essais >= 5) return false;
  const ok = !!pin && PropertiesService.getScriptProperties().getProperty('NIP_HASH') === hash_(String(pin));
  if (!ok) cache.put('essais', String(essais + 1), 600);
  return ok;
}
const actif_ = (o) => o.supprime !== true && String(o.supprime).toUpperCase() !== 'TRUE';
const photoUrl_ = (id) => 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1200';

function histoire_(h, master) {
  return {
    id: h.id, date: h.date instanceof Date ? h.date.toISOString() : String(h.date), auteur: h.auteur, titre: h.titre,
    texte: h.texte, categorie: h.categorie, lon: h.lon === '' ? null : Number(h.lon), lat: h.lat === '' ? null : Number(h.lat),
    photos: String(h.photos || '').split(',').filter(String).map(photoUrl_),
    approuve: h.approuve === true,
  };
}

/* ---------- Lecture (invités) ---------- */
function donnees_(master) {
  return {
    ok: true,
    points: lire_('Points').filter(actif_).filter((p) => master || p.visibilite !== 'master')
      .map((p) => ({ id: p.id, nom: p.nom, type: p.type, note: p.note, visibilite: p.visibilite, lon: Number(p.lon), lat: Number(p.lat) })),
    traces: lire_('Traces').filter(actif_).filter((t) => master || t.visibilite !== 'master')
      .map((t) => ({ id: t.id, nom: t.nom, type: t.type, visibilite: t.visibilite, coords: JSON.parse(t.coords || '[]') })),
    reperes: lire_('Reperes').filter(actif_)
      .map((r) => ({ id: r.id, km: Number(r.km), nom: r.nom, consigne: r.consigne, lon: Number(r.lon), lat: Number(r.lat) })),
    histoires: lire_('Histoires').filter(actif_).filter((h) => master || h.approuve === true).map((h) => histoire_(h, master)),
  };
}
function doGet(e) {
  try { return json_(donnees_(false)); } catch (err) { return json_({ ok: false, erreur: String(err) }); }
}

/* ---------- Écriture ---------- */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, erreur: 'JSON invalide' }); }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    if (body.action === 'histoire') return json_(ajouterHistoire_(body));
    if (body.action === 'master.verifier') return json_({ ok: nipOk_(body.nip) });
    if (body.action === 'master.donnees') return nipOk_(body.nip) ? json_(donnees_(true)) : json_({ ok: false, erreur: 'NIP' });
    if (body.action === 'master.sync') {
      if (!nipOk_(body.nip)) return json_({ ok: false, erreur: 'NIP' });
      const faits = [];
      (body.ops || []).forEach((op) => { appliquer_(op); faits.push(op.uid); });
      return json_({ ok: true, faits: faits });
    }
    return json_({ ok: false, erreur: 'action inconnue' });
  } catch (err) {
    return json_({ ok: false, erreur: String(err) });
  } finally { lock.releaseLock(); }
}

function ajouterHistoire_(b) {
  if (b.site) return { ok: true }; // champ piège anti-robot
  const auteur = String(b.auteur || '').trim().slice(0, 60);
  const texte = String(b.texte || '').trim().slice(0, 5000);
  if (!auteur || (!texte && !(b.photos || []).length)) return { ok: false, erreur: 'Nom et texte requis' };
  const id = String(b.id || ('h-' + Utilities.getUuid().slice(0, 8))).slice(0, 40);
  if (lire_('Histoires').some((h) => String(h.id) === id)) return { ok: true, id: id, deja: true };
  const dossier = dossierPhotos_();
  const ids = (b.photos || []).slice(0, MAX_PHOTOS).map((b64, i) => {
    const blob = Utilities.newBlob(Utilities.base64Decode(String(b64).replace(/^data:image\/\w+;base64,/, '')), 'image/jpeg', id + '-' + (i + 1) + '.jpg');
    const f = dossier.createFile(blob);
    f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return f.getId();
  });
  ecrire_('Histoires', {
    id: id, date: b.date || new Date().toISOString(), auteur: auteur, titre: String(b.titre || '').slice(0, 120), texte: texte,
    categorie: ['peche', 'chasse', 'chalet'].indexOf(b.categorie) >= 0 ? b.categorie : 'chalet',
    lon: b.lon || '', lat: b.lat || '', photos: ids.join(','), approuve: false, supprime: false,
  });
  return { ok: true, id: id };
}

function appliquer_(op) {
  const now = new Date().toISOString(); const d = op.data || {};
  switch (op.type) {
    case 'point':
      ecrire_('Points', op.supprimer ? { id: op.id, supprime: true, modifie: now } :
        { id: op.id, nom: d.nom, type: d.type, note: d.note || '', visibilite: d.visibilite || 'tous', lon: d.lon, lat: d.lat, modifie: now, supprime: false });
      break;
    case 'trace':
      ecrire_('Traces', op.supprimer ? { id: op.id, supprime: true, modifie: now } :
        { id: op.id, nom: d.nom, type: d.type, visibilite: d.visibilite || 'tous', coords: JSON.stringify(d.coords || []), modifie: now, supprime: false });
      break;
    case 'repere':
      ecrire_('Reperes', op.supprimer ? { id: op.id, supprime: true, modifie: now } :
        { id: op.id, km: d.km, nom: d.nom, consigne: d.consigne, lon: d.lon, lat: d.lat, modifie: now, supprime: false });
      break;
    case 'histoire':
      ecrire_('Histoires', op.supprimer ? { id: op.id, supprime: true } : { id: op.id, approuve: d.approuve === true });
      break;
  }
}
