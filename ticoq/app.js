/* Ti-Coq Gestion — app du cellulaire de Kevin (v1.0.0, 25 nov. 2026)
   Commandes de poulet à approuver / refuser + notifications.
   Les données restent sur ti-coq.com (fonction /_functions/tcapp); ce dépôt ne contient aucune donnée. */
'use strict';
const API = 'https://www.ti-coq.com/_functions/tcapp';
const LS_T = 'tcapp_t';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
let ORDERS = [];
let busy = false;

function tok() { try { return localStorage.getItem(LS_T) || ''; } catch (e) { return ''; } }
function setTok(t) { try { if (t) localStorage.setItem(LS_T, t); else localStorage.removeItem(LS_T); } catch (e) {} }

function toast(msg, err) {
  const t = $('toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2800);
}

async function api(m) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(m), cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!j) throw new Error('Pas de réponse de ti-coq.com (' + r.status + ')');
  if (!j.ok) {
    if (/non jumel/i.test(j.error || '')) { setTok(''); show(); }
    throw new Error(j.error || 'Erreur');
  }
  return j;
}

// ---------- Écrans ----------
function show() {
  const t = tok();
  $('scrInstall').hidden = !(isIOS && !standalone);
  $('scrPair').hidden = !!t || (isIOS && !standalone);
  $('scrMain').hidden = !t || (isIOS && !standalone);
  $('btnRefresh').hidden = !t;
  if (t && !(isIOS && !standalone)) { notifUi(); load(); }
}

// ---------- Jumelage ----------
$('btnPair').onclick = async () => {
  const code = $('pairCode').value.trim();
  if (!code) { $('pairMsg').textContent = 'Entre ton code.'; return; }
  $('btnPair').disabled = true; $('pairMsg').textContent = 'Vérification…';
  try {
    const r = await api({ a: 'pair', code, dev: navigator.userAgent });
    setTok(r.t); $('pairCode').value = ''; $('pairMsg').textContent = '';
    toast('Cellulaire jumelé 👍'); show();
  } catch (e) { $('pairMsg').textContent = e.message; }
  $('btnPair').disabled = false;
};
$('btnUnpair').onclick = async () => {
  if ($('btnUnpair').dataset.arm !== '1') { $('btnUnpair').dataset.arm = '1'; $('btnUnpair').textContent = 'Touche encore pour confirmer'; setTimeout(() => { $('btnUnpair').dataset.arm = ''; $('btnUnpair').textContent = 'Déjumeler ce cellulaire'; }, 4000); return; }
  try { await api({ a: 'unpair', t: tok() }); } catch (e) {}
  setTok(''); show();
};

// ---------- Notifications ----------
function notifOk() { return 'Notification' in window && Notification.permission === 'granted'; }
function notifUi() {
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  $('notifBanner').hidden = !supported || (notifOk() && localStorage.getItem('tcapp_sub') === '1');
  $('btnTest').hidden = !notifOk();
  if (notifOk() && localStorage.getItem('tcapp_sub') !== '1') subscribe().catch(() => {});
}
function b64ToU8(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
async function subscribe() {
  const reg = await navigator.serviceWorker.ready;
  const { pub } = await api({ a: 'vapid' });
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(pub) });
  await api({ a: 'sub', t: tok(), sub: sub.toJSON() });
  localStorage.setItem('tcapp_sub', '1');
  notifUi();
}
$('btnNotif').onclick = async () => {
  try {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { toast('Notifications refusées. Réglages › Notifications › Ti-Coq pour les permettre.', true); return; }
    await subscribe(); toast('Notifications activées 🔔');
  } catch (e) { toast(e.message, true); }
};
$('btnTest').onclick = async () => {
  try { await subscribe(); await api({ a: 'test', t: tok() }); toast('Test envoyé — la notification arrive dans quelques secondes.'); }
  catch (e) { toast(e.message, true); }
};

// ---------- Commandes ----------
const JOURS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
function frD(iso) { if (!iso) return ''; const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? iso : JOURS[d.getDay()] + ' ' + d.getDate() + ' ' + MOIS[d.getMonth()]; }
function hm(s) { return String(s || '').slice(11, 16); }
const STATUS = { a_approuver: 'À approuver', approuvee: 'À placer', placee: 'Placée chez Exceldor', confirmee: 'Confirmée', recue: 'Reçue', refusee: 'Refusée' };
function chipOf(o) { const sg = stageOf(o); if (sg === 'done') return ['recue', 'Reçue' + (o.diff ? ' · écart' : '')]; return [o.status, STATUS[o.status] || o.status]; }
const n = (v) => (v == null || v === '' ? '—' : esc(v));

function todoCard(o) {
  const c = o.calc || {};
  const why = [o.reason && 'Raison du gérant : ' + o.reason, o.stdWhy && 'Standing : ' + o.stdWhy, o.erWhy && 'En route : ' + o.erWhy, o.stkCalc && 'Stock : ' + o.stkCalc]
    .filter(Boolean).map((w) => '<div class="why">' + esc(w) + '</div>').join('');
  const diff = c.sug != null && Number(c.sug) !== Number(o.qty);
  return '<div class="card todo" data-k="' + esc(o.st + '|' + o.id) + '">' +
    '<div class="row"><div><div class="store">' + esc(o.name) + '</div><div class="small mut">Livraison ' + esc(frD(o.delivery)) + ' · envoyée à ' + esc(hm(o.at)) + (o.by ? ' par ' + esc(o.by) : '') + '</div></div>' +
    '<span class="chip c-a_approuver">À approuver</span></div>' +
    '<div class="row" style="margin-top:12px"><div class="qty">' + esc(o.qty) + ' <small>caisses demandées</small></div>' +
    (c.sug != null ? '<div class="small ' + (diff ? '' : 'mut') + '" style="text-align:right' + (diff ? ';color:var(--jaune);font-weight:700' : '') + '">Suggéré<br><b style="font-size:20px">' + esc(c.sug) + '</b></div>' : '') + '</div>' +
    '<div class="grid"><div><span>Standing</span><b>' + n(c.standing) + '</b></div><div><span>Moyenne</span><b>' + n(c.avg) + '</b></div><div><span>Dernière</span><b>' + n(c.last) + '</b></div>' +
    '<div><span>Stock</span><b>' + n(c.stk) + '</b></div><div><span>En route</span><b>' + n(c.er) + '</b></div><div><span>Besoin</span><b>' + n(c.need) + '</b></div></div>' +
    (c.below ? '<div class="why" style="border-color:var(--rouge)">Standing sous la moyenne</div>' : '') + why + histHtml(o) +
    '<div class="step"><button data-d="-1">−</button><input type="number" inputmode="numeric" class="q" value="' + esc(o.qty) + '"><button data-d="1">+</button><span class="small mut">caisses à approuver</span></div>' +
    '<textarea class="com" placeholder="Commentaire au gérant (obligatoire pour refuser)"></textarea>' +
    '<div class="acts"><button class="btn no" data-act="refuse">Refuser</button><button class="btn ok" data-act="ok">Approuver</button></div></div>';
}
// Historique : la même commande a été refusée puis refaite
function histHtml(o) {
  return (o.hist || []).filter((h) => h.status === 'refusee').map((h) => '<div class="small" style="margin-top:4px;color:#ff8a8d">Refusée ' + esc(hm(h.decidedAt)) + ' (' + esc(h.qty) + ' caisses)' + (h.kComment ? ' : « ' + esc(h.kComment) + ' »' : '') + ' — refaite par le gérant</div>').join('');
}
function restLine(o) {
  const q = o.status === 'refusee' ? o.qty : (o.approvedQty != null ? o.approvedQty : o.qty);
  return '<div class="li"><div><b>Livraison ' + esc(frD(o.delivery)) + '</b> · ' + esc(q) + ' caisses<div class="small mut">' + (o.status === 'refusee' ? 'Refusée ' + esc(hm(o.decidedAt)) + ' · en attente que le gérant la refasse' : 'Approuvée ' + esc(hm(o.decidedAt)) + (o.auto ? ' (auto)' : '')) + '</div>' +
    (o.kComment ? '<div class="small" style="margin-top:4px">« ' + esc(o.kComment) + ' »</div>' : '') + histHtml(o) + '</div>' +
    '<div><span class="chip c-' + esc(chipOf(o)[0]) + '">' + esc(chipOf(o)[1]) + '</span></div></div>';
}
const ST_ORDER = ['stl', 'cap', 'bel', 'j23'];
function stageOf(o) { return o.stage || (o.status === 'a_approuver' || o.status === 'refusee' ? 'todo' : (['recue', 'recu', 'ferme'].indexOf(o.status) >= 0 ? 'done' : 'recv')); }
// Regroupe par succursale (St-Louis, Cap, Bellefeuille, Jean-XXIII), livraison la plus récente en premier
function byStore(list) {
  return ST_ORDER.map((st) => list.filter((o) => o.st === st).sort((a, b) => String(b.delivery || '').localeCompare(String(a.delivery || ''))))
    .filter((g) => g.length)
    .map((g) => '<div class="card"><div class="store" style="font-size:18px;margin-bottom:2px">' + esc(g[0].name) + '</div>' + g.map(restLine).join('') + '</div>').join('');
}
function render() {
  const todo = ORDERS.filter((o) => o.status === 'a_approuver');
  const waiting = ORDERS.filter((o) => o.status === 'refusee' && stageOf(o) === 'todo');
  const recv = ORDERS.filter((o) => stageOf(o) === 'recv');
  const done = ORDERS.filter((o) => stageOf(o) === 'done');
  $('todo').innerHTML = '<div class="lbl">① À approuver</div>' +
    (todo.length ? todo.sort((a, b) => ST_ORDER.indexOf(a.st) - ST_ORDER.indexOf(b.st)).map(todoCard).join('') : (waiting.length ? '' : '<div class="card empty"><b>Rien à approuver 👌</b>Tu recevras une notification dès qu\'un gérant en envoie une.</div>')) +
    (waiting.length ? byStore(waiting) : '');
  $('rest').innerHTML = '<div class="lbl">② Approuvées · à recevoir</div>' + (recv.length ? byStore(recv) : '<div class="card empty small">Aucune commande en attente de livraison.</div>') +
    '<div class="lbl">③ Finalisées · reçues</div>' + (done.length ? byStore(done) : '<div class="card empty small">Aucune commande reçue ces 10 derniers jours.</div>');
  try { if (navigator.setAppBadge) { if (todo.length) navigator.setAppBadge(todo.length); else navigator.clearAppBadge(); } } catch (e) {}
}
async function load() {
  if (busy) return; busy = true; $('btnRefresh').textContent = '…';
  try {
    const r = await api({ a: 'list', t: tok() });
    ORDERS = r.orders || [];
    // Ne pas effacer un commentaire en cours d'écriture
    const typing = Array.from(document.querySelectorAll('#todo .com')).some((x) => x.value.trim()) || ($('todo').contains(document.activeElement) && document.activeElement !== document.body);
    if (!typing) render();
    $('foot').textContent = 'Mis à jour à ' + hm(r.now);
  } catch (e) { toast(e.message, true); }
  busy = false; $('btnRefresh').textContent = '↻';
}
$('btnRefresh').onclick = load;

$('todo').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button'); if (!b) return;
  const card = b.closest('.card'); if (!card) return;
  const qi = card.querySelector('.q');
  if (b.dataset.d) { qi.value = Math.max(0, (Number(qi.value) || 0) + Number(b.dataset.d)); return; }
  const act = b.dataset.act; if (!act) return;
  const [st, id] = card.dataset.k.split('|');
  const com = card.querySelector('.com').value.trim();
  if (act === 'refuse' && !com) { toast('Écris la raison du refus pour le gérant.', true); card.querySelector('.com').focus(); return; }
  card.querySelectorAll('button').forEach((x) => { x.disabled = true; });
  try {
    await api({ a: 'decide', t: tok(), st, id, action: act, qty: qi.value, comment: com });
    toast(act === 'ok' ? 'Approuvée ✅' : 'Refusée — le gérant verra ta raison');
    await load();
  } catch (e) { toast(e.message, true); card.querySelectorAll('button').forEach((x) => { x.disabled = false; }); load(); }
});

// ---------- Démarrage ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'refresh' && tok()) load(); });
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && tok() && !$('scrMain').hidden) load(); });
show();
