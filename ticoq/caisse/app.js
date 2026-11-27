/* Caisse Ti-Coq — app de l'iPad Caisse (V1.0.0, 27 nov. 2026, Kevin)
   Affiche ti-coq.com/caisse en plein écran (rien à changer dans la page Wix) et ajoute les alarmes :
   10 h Caisse 2 (PM) ouverte · 11 h Caisse 1 (dîner) ouverte · 13 h Caisse 1 (dîner) fermée ·
   16 h Caisse 1 (souper) ouverte + Caisse 2 (PM) fermée et ré-ouverte (veillée) · 20 h Caisse 1 fermée · 22 h Caisse 2 fermée.
   Les règles sont dans le serveur (backend/ticoq-caisseapp.js) ; l'app demande l'état chaque minute. */
'use strict';
const VERSION = '1.1.0';
const API = 'https://www.ti-coq.com/_functions/caisseapp';
const PAGE = 'https://www.ti-coq.com/caisse';
const STORES = [['stl', 'St-Louis-de-France'], ['cap', 'Cap-de-la-Madeleine'], ['bel', 'Bellefeuille'], ['j23', 'Jean-XXIII']];
const SNOOZE = 3 * 60 * 1000;
const $ = (id) => document.getElementById(id);
const LS = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: (k) => { try { localStorage.removeItem(k); } catch (e) {} } };
const S = { st: null, state: null, snoozeUntil: 0, started: false, ctx: null, ringT: null, lastErr: '', pollT: null };

function toast(t, bad) { const e = $('toast'); e.textContent = t; e.style.borderColor = bad ? '#D7262B' : ''; e.classList.remove('hide'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.add('hide'), 4000); }
async function api(m) {
  const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(m), cache: 'no-store' });
  const j = await r.json();
  return j;
}
const tok = () => LS.get('tcc_t');

// ---------- Jumelage ----------
function showPair() {
  ['start', 'alarm', 'dot', 'menu', 'frame', 'gerBtn', 'gwrap', 'gerTop', 'gerAsk'].forEach((i) => $(i).classList.add('hide'));
  $('pair').classList.remove('hide');
  $('stores').innerHTML = STORES.map((s) => '<button data-st="' + s[0] + '" class="' + (S.st === s[0] ? 'on' : '') + '">' + s[1] + '</button>').join('');
}
$('stores').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.st = b.dataset.st; showPair(); });
$('pairBtn').addEventListener('click', async () => {
  $('pairErr').textContent = '';
  if (!S.st) { $('pairErr').textContent = 'Choisis la succursale.'; return; }
  try {
    const r = await api({ a: 'pair', st: S.st, code: $('code').value, dev: navigator.userAgent });
    if (!r.ok) { $('pairErr').textContent = r.error || 'Refusé'; return; }
    LS.set('tcc_t', r.t); LS.set('tcc_st', r.st); LS.set('tcc_name', r.name); LS.set('tcc_g', $('code').value.trim()); LS.set('tcc_gst', r.st); $('code').value = '';
    $('pair').classList.add('hide'); boot(true);
  } catch (e) { $('pairErr').textContent = 'Pas de connexion : ' + e.message; }
});

// ---------- Son ----------
function audioUnlock() {
  try {
    if (!S.ctx) S.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (S.ctx.state === 'suspended') S.ctx.resume();
    const o = S.ctx.createOscillator(), g = S.ctx.createGain(); g.gain.value = 0.0001; o.connect(g); g.connect(S.ctx.destination); o.start(); o.stop(S.ctx.currentTime + 0.05);
  } catch (e) {}
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) {}
}
function beep(t0, f, d) {
  const c = S.ctx, o = c.createOscillator(), g = c.createGain();
  o.type = 'square'; o.frequency.value = f; o.connect(g); g.connect(c.destination);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.6, t0 + 0.02); g.gain.setValueAtTime(0.6, t0 + d - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
  o.start(t0); o.stop(t0 + d + 0.02);
}
function ringOnce(msgs) {
  try {
    if (!S.ctx) return;
    if (S.ctx.state === 'suspended') S.ctx.resume();
    const t = S.ctx.currentTime + 0.05;
    for (let i = 0; i < 6; i++) { beep(t + i * 0.5, 1046, 0.22); beep(t + i * 0.5 + 0.25, 784, 0.22); }
  } catch (e) {}
  setTimeout(() => {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('Attention. ' + msgs.join('. ') + '.');
      u.lang = 'fr-CA'; u.rate = 0.95; u.volume = 1; speechSynthesis.speak(u);
    } catch (e) {}
  }, 3200);
}

// ---------- Alarmes ----------
function render() {
  const A = (S.state && S.state.actives) || [];
  const on = A.length && Date.now() >= S.snoozeUntil;
  $('dot').classList.toggle('warn', !!A.length);
  $('dot').textContent = A.length ? '⏰' : '🔔';
  if (on) {
    $('alarmMsg').innerHTML = A.map((a) => '<div>' + a.msg.replace(/[<&]/g, '') + '</div>').join('');
    if ($('alarm').classList.contains('hide')) { $('alarm').classList.remove('hide'); ringOnce(A.map((a) => a.msg)); }
    if (!S.ringT) S.ringT = setInterval(() => { const L = (S.state && S.state.actives) || []; if (L.length && Date.now() >= S.snoozeUntil) ringOnce(L.map((a) => a.msg)); }, 15000);
  } else {
    $('alarm').classList.add('hide');
    if (S.ringT) { clearInterval(S.ringT); S.ringT = null; }
    try { if (!A.length) speechSynthesis.cancel(); } catch (e) {}
  }
}
$('alarmOk').addEventListener('click', () => { begin(); S.snoozeUntil = Date.now() + SNOOZE; try { speechSynthesis.cancel(); } catch (e) {} render(); setTimeout(render, SNOOZE + 500); });

async function poll() {
  if (!tok()) return;
  try {
    const r = await api({ a: 'state', t: tok() });
    if (r && r.unpaired) { LS.del('tcc_t'); showPair(); return; }
    if (!r || !r.ok) throw new Error((r && r.error) || 'réponse vide');
    const before = (S.state && S.state.actives || []).map((a) => a.id).join(',');
    S.state = r; S.lastErr = '';
    const now = r.actives.map((a) => a.id).join(',');
    if (now && now !== before) S.snoozeUntil = 0; // une nouvelle alarme sonne tout de suite
    render();
  } catch (e) { S.lastErr = String(e.message || e); }
}

// ---------- Notifications (même quand l'app est fermée) ----------
function b64ToU8(s) { const p = '='.repeat((4 - s.length % 4) % 4); const b = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
async function subscribe() {
  const v = await api({ a: 'vapid' });
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(v.pub) });
  const r = await api({ a: 'sub', t: tok(), sub: sub.toJSON() });
  if (!r.ok) throw new Error(r.error || 'abonnement refusé');
  LS.set('tcc_sub', '1');
}
async function askNotif() {
  if (!pushSupported()) return 'non';
  try {
    let p = Notification.permission;
    if (p === 'default') p = await Notification.requestPermission();
    if (p !== 'granted') return 'refus';
    await subscribe();
    return 'ok';
  } catch (e) { return 'err ' + e.message; }
}

// ---------- Menu (petit bouton en bas à droite) ----------
function menuHtml() {
  const st = S.state;
  const A = (st && st.actives) || [];
  const np = !pushSupported() ? 'pas offertes (installe l’app sur l’écran d’accueil)' : Notification.permission === 'granted' ? (LS.get('tcc_sub') ? 'activées ✓' : 'permises, pas encore inscrites') : Notification.permission === 'denied' ? 'refusées (Réglages › Notifications › Caisse)' : 'pas encore permises';
  return '<div style="font-weight:800;font-size:16px">Caisse Ti-Coq · ' + (LS.get('tcc_name') || '') + '</div>' +
    '<div class="ln">' + (A.length ? '⏰ ' + A.map((a) => a.msg).join(' · ') : '✓ Aucune alarme en ce moment') + '</div>' +
    '<div class="ln" style="color:var(--mut)">Notifications : ' + np + '</div>' +
    (S.lastErr ? '<div class="ln" style="color:#ff8a8d">Serveur : ' + S.lastErr + '</div>' : '') +
    '<div class="ln" style="color:var(--mut)">Alarmes : 10 h, 11 h, 13 h, 16 h, 20 h, 22 h · v' + VERSION + '</div>' +
    '<button class="btn sec" data-m="notif">🔔 Tester l’alarme et les notifications</button>' +
    '<button class="btn sec" data-m="reload">↻ Recharger la caisse</button>' +
    '<button class="btn sec" data-m="unpair" style="border-color:#D7262B;color:#ff8a8d">Déjumeler cet iPad</button>';
}
$('dot').addEventListener('click', () => { const m = $('menu'); if (m.classList.contains('hide')) { m.innerHTML = menuHtml(); m.classList.remove('hide'); } else m.classList.add('hide'); });
$('menu').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  const k = b.dataset.m;
  if (k === 'reload') { $('frame').src = PAGE + '?r=' + Date.now(); $('menu').classList.add('hide'); }
  if (k === 'notif') {
    audioUnlock();
    $('menu').classList.add('hide');
    // alarme de test à l'écran (son + voix)
    $('alarmMsg').innerHTML = '<div>TEST — l’alarme de la caisse fonctionne</div>';
    $('alarm').classList.remove('hide'); ringOnce(['Test de l’alarme de la caisse']);
    setTimeout(() => { if (!((S.state && S.state.actives) || []).length) $('alarm').classList.add('hide'); }, 9000);
    const r = await askNotif();
    if (r === 'ok') {
      toast('Ferme l’app maintenant : la notification de test arrive dans 8 secondes.');
      const t = await api({ a: 'test', t: tok(), delay: 8 });
      const codes = (t.res || []).join(', ');
      if (!t.ok) toast('Test refusé : ' + t.error, true);
      else if (!t.n) { LS.del('tcc_sub'); toast('Cet iPad n’est pas inscrit aux notifications. Touche encore « Activer / tester ».', true); }
      else if ((t.res || []).every((c) => c === 201 || c === 200)) toast('Notification envoyée ✓ (Apple a accepté : ' + codes + ')');
      else toast('Apple a refusé la notification (' + codes + '). Envoie une capture à Claude.', true);
    } else toast(r === 'non' ? 'Notifications pas offertes ici : ouvre l’app par son icône sur l’écran d’accueil (iPadOS 16.4 ou plus).' : r === 'refus' ? 'Notifications refusées : Réglages › Notifications › Caisse › Autoriser.' : 'Erreur : ' + r, true);
  }
  if (k === 'unpair') {
    if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Toucher encore pour confirmer'; return; }
    try { await api({ a: 'unpair', t: tok() }); } catch (x) {}
    ['tcc_t', 'tcc_st', 'tcc_name', 'tcc_sub'].forEach(LS.del); location.reload();
  }
});

// ---------- Jumelage de la page Caisse (Safari efface sa mémoire dans l'app : l'app le lui redonne) ----------
const EMBED_O = 'https://www-ti-coq-com.filesusr.com';
window.addEventListener('message', (e) => {
  if (e.origin !== EMBED_O) return;
  const m = e.data;
  if (m && m.tc === 'caisseapp-paired' && m.g) { LS.set('tcc_g', m.g); LS.set('tcc_gst', m.st || ''); S.embedOk = true; }
});
function feedEmbed() {
  const g = LS.get('tcc_g'), st = LS.get('tcc_gst') || LS.get('tcc_st');
  if (!g || !st) return;
  try {
    const w = $('frame').contentWindow;
    for (let i = 0; i < w.frames.length; i++) { try { w.frames[i].postMessage({ tc: 'caisseapp-pair', st, g }, EMBED_O); } catch (x) {} }
  } catch (x) {}
}
$('frame').addEventListener('load', () => { S.embedOk = false; let n = 0; clearInterval(S.feedT); S.feedT = setInterval(() => { feedEmbed(); if (++n > 30) clearInterval(S.feedT); }, 2000); });

// ---------- Accès gérant : console de gestion de la succursale (code du gérant demandé à chaque fois) ----------
// L'iPad reste verrouillé en paysage pour la caisse ; la console du gérant s'affiche « en portrait » (tournée de 90°) :
// on tourne l'iPad et la console est droite. « ↻ Tourner » change le sens (gardé sur l'iPad).
const GPAGE = 'https://www.ti-coq.com/gestion';
const GER_MAX = 30 * 60 * 1000; // retour automatique à la caisse après 30 minutes
function postFrames(ifr, msg) { try { const w = ifr.contentWindow; for (let i = 0; i < w.frames.length; i++) { try { w.frames[i].postMessage(msg, EMBED_O); } catch (x) {} } } catch (x) {} }
function gerLogin() { if (S.gCode) postFrames($('gframe'), { tc: 'gestapp-login', st: LS.get('tcc_st'), code: S.gCode }); }
function gerLayout() {
  const g = $('gwrap'), t = $('gerTop'), r = LS.get('tcc_rot') || 'cw';
  const land = window.innerWidth > window.innerHeight;
  g.classList.toggle('rot', land); g.classList.toggle('cw', land && r === 'cw'); g.classList.toggle('ccw', land && r === 'ccw');
  g.style.setProperty('--gw', g.clientWidth + 'px'); g.style.setProperty('--gh', g.clientHeight + 'px');
  t.className = (t.classList.contains('hide') ? 'hide ' : '') + (land ? r : 'flat');
}
window.addEventListener('resize', () => { if (S.gOk) gerLayout(); });
function gerFail(t) {
  S.gCode = null; clearInterval(S.gT); clearTimeout(S.gTo);
  $('gframe').src = 'about:blank'; $('gwrap').classList.add('hide');
  $('gerErr').textContent = t; $('gerGo').disabled = false;
}
$('gerBtn').addEventListener('click', () => {
  $('gerCode').value = ''; $('gerErr').textContent = ''; $('gerGo').disabled = false;
  $('gerSub').textContent = 'Console du gérant — ' + (LS.get('tcc_name') || '') + '. Entre ton code de gérant.';
  $('gerAsk').classList.remove('hide'); setTimeout(() => $('gerCode').focus(), 80);
});
$('gerCancel').addEventListener('click', () => { gerFail(''); $('gerAsk').classList.add('hide'); });
$('gerCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('gerGo').click(); });
$('gerGo').addEventListener('click', () => {
  const code = $('gerCode').value.trim();
  if (!code) { $('gerErr').textContent = 'Entre ton code.'; return; }
  S.gCode = code; S.gOk = false; $('gerGo').disabled = true; $('gerErr').textContent = 'Vérification…';
  $('gframe').src = GPAGE + '?r=' + Date.now();
  let n = 0; clearInterval(S.gT); S.gT = setInterval(() => { gerLogin(); if (++n > 15) { clearInterval(S.gT); if (!S.gOk) gerFail('La console ne répond pas. Vérifie la connexion et réessaie.'); } }, 3000);
});
function gerShow() {
  S.gOk = true; S.gCode = null; clearInterval(S.gT);
  $('gerAsk').classList.add('hide'); $('gerCode').value = '';
  $('gwrap').classList.remove('hide'); $('gerTop').classList.remove('hide'); $('gerBtn').classList.add('hide'); $('dot').classList.add('hide');
  gerLayout();
  clearTimeout(S.gTo); S.gTo = setTimeout(gerBack, GER_MAX);
}
function gerBack() {
  clearTimeout(S.gTo); clearInterval(S.gT); S.gCode = null;
  if (S.gOk) postFrames($('gframe'), { tc: 'gestapp-logout' });
  S.gOk = false;
  setTimeout(() => { $('gframe').src = 'about:blank'; }, 400);
  $('gwrap').classList.add('hide'); $('gerTop').classList.add('hide');
  if (tok()) { $('gerBtn').classList.remove('hide'); $('dot').classList.remove('hide'); }
}
$('gerBack').addEventListener('click', gerBack);
$('gerRot').addEventListener('click', () => { LS.set('tcc_rot', (LS.get('tcc_rot') || 'cw') === 'cw' ? 'ccw' : 'cw'); gerLayout(); });
window.addEventListener('message', (e) => {
  if (e.origin !== EMBED_O || !e.data) return;
  const m = e.data;
  if (m.tc === 'gestapp-ready') gerLogin();
  else if (m.tc === 'gestapp-ok' && !S.gOk && !$('gerAsk').classList.contains('hide')) gerShow();
  else if (m.tc === 'gestapp-err' && S.gCode) gerFail(m.err || 'Code refusé');
});

// ---------- Démarrage ----------
function begin() {
  if (S.started) return;
  S.started = true;
  audioUnlock();
  $('start').classList.add('hide');
  if (!LS.get('tcc_sub')) askNotif().then((r) => { if (r === 'refus') toast('Notifications refusées : Réglages › Notifications › Caisse.', true); });
  try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
  const L = (S.state && S.state.actives) || [];
  if (L.length && Date.now() >= S.snoozeUntil) ringOnce(L.map((a) => a.msg));
  poll();
}
$('start').addEventListener('click', begin);
function boot() {
  if (!tok()) { showPair(); return; }
  $('frame').src = PAGE;
  $('frame').classList.remove('hide');
  $('dot').classList.remove('hide');
  $('gerBtn').classList.remove('hide');
  $('startSub').textContent = (LS.get('tcc_name') || '') + ' — les alarmes de la caisse (son et notifications) s’activent.';
  $('start').classList.remove('hide');
  clearInterval(S.pollT); S.pollT = setInterval(poll, 60000);
  poll();
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && (S.gOk || S.gCode)) gerBack(); // l'iPad quitte l'app : la console du gérant se ferme
  if (document.visibilityState === 'visible' && tok()) {
    poll();
    // au retour (iPad réveillé) : un toucher est requis de nouveau pour le son
    if (S.started && S.ctx && S.ctx.state !== 'running') { S.started = false; $('start').classList.remove('hide'); }
    try { if (navigator.wakeLock) navigator.wakeLock.request('screen').catch(() => {}); } catch (e) {}
  }
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js', { scope: './', updateViaCache: 'none' }).catch(() => {});
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data && e.data.type === 'refresh') poll(); });
}
boot();
