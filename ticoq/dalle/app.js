/* Dalle Ti-Coq — app iPad v1.0.0 (27 nov. 2026)
   - Affiche la Dalle (ti-coq.com/_functions/dalle) et garde le dernier affichage quand le Wi-Fi coupe.
   - La Dalle est lue en arrière-plan toutes les 10 s ; on ne remplace l'écran que par une Dalle complète.
   - La dernière Dalle est gardée sur l'iPad : l'app rouvre avec elle même sans réseau.
   - Alarmes sonores (dalleAlarm), mêmes sons que la page « Dalle son ». */
(function () {
  'use strict';
  var APP_VERSION = '1.0.0';
  var FN = 'https://www.ti-coq.com/_functions/';
  var BASE = FN + 'dalle', API = FN + 'dalleAlarm', CSS = FN + 'dalleCss';
  var TICK = 10000, REPEAT = 20000, FETCH_MS = 8000;

  function ls(key, val) {
    try { if (val === undefined) return localStorage.getItem(key); if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val); } catch (e) {}
    return null;
  }
  function hashK() { var m = /[#&]k=([^&]+)/.exec(location.hash || ''); return m ? decodeURIComponent(m[1]) : ''; }

  // ---------- Retour du jumelage : cette page s'ouvre dans le cadre de jumelage avec #k=jeton ----------
  if (window.top !== window) {
    var hk = hashK();
    if (hk) { ls('tcd_k', hk); try { window.parent.postMessage({ dalleK: hk }, location.origin); } catch (e) {} }
    document.documentElement.innerHTML = '<body style="background:#0b0b0c;color:#fff;font:600 20px system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">iPad jumelé ✔</body>';
    return;
  }

  if ('serviceWorker' in navigator) { try { navigator.serviceWorker.register('sw.js'); } catch (e) {} }

  function $(id) { return document.getElementById(id); }
  var k = ls('tcd_k') || '';
  var hk0 = hashK();
  if (hk0) { k = hk0; ls('tcd_k', k); try { history.replaceState(null, '', location.pathname); } catch (e) {} }
  var view = 'w';
  (function () { var sv = ls('tcd_view') || ''; view = 'w' + (sv.indexOf('c') >= 0 ? 'c' : '') + (sv.indexOf('r') >= 0 ? 'r' : ''); })();
  var css = ls('tcd_css') || '';
  var lastOkAt = Number(ls('tcd_at')) || 0;   // heure de la dernière Dalle reçue
  var failSince = 0;                          // début de la coupure en cours
  var lastAlarm = null, on = false, ctx = null, timer = null, busy = false, ready = false, nextShelf = 0, nextCall = 0;
  var wake = null;

  function vis() { return $('fa').classList.contains('on') ? $('fa') : $('fb'); }
  function hid() { return vis() === $('fa') ? $('fb') : $('fa'); }
  function q() { return '?k=' + encodeURIComponent(k) + '&v=' + encodeURIComponent(view) + '&t=' + Date.now(); }
  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function hm(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }

  // Prépare la page reçue pour l'afficher depuis l'app : liens vers ti-coq.com, style intégré (marche hors ligne).
  function build(h) {
    var out = String(h).replace(/<head>/i, '<head><base href="' + FN + '">');
    if (css) out = out.replace(/<link rel="stylesheet" href="dalleCss">/, function () { return '<style>' + css + '</style>'; });
    return out;
  }
  // Affiche une Dalle : on la charge dans le cadre caché, puis on échange (pas d'écran blanc).
  function show(h) {
    var f = hid();
    f.onload = function () { f.onload = null; var o = vis(); try { f.contentWindow.scrollTo(0, o.contentWindow.scrollY || 0); } catch (e) {} o.classList.remove('on'); f.classList.add('on'); };
    f.srcdoc = build(h);
  }
  // Le cadre visible a-t-il quitté la Dalle gardée (bouton touché, page du serveur) ?
  function navigated() { try { return !vis().contentDocument || vis().contentDocument.URL !== 'about:srcdoc'; } catch (e) { return true; } }

  function timeout(ms) { var ac = window.AbortController ? new AbortController() : null; var to = setTimeout(function () { if (ac) ac.abort(); }, ms); return { signal: ac ? ac.signal : undefined, done: function () { clearTimeout(to); } }; }
  async function getText(url) {
    var t = timeout(FETCH_MS);
    try { var r = await fetch(url, { cache: 'no-store', signal: t.signal }); var x = await r.text(); t.done(); return { ok: r.ok, text: x }; }
    catch (e) { t.done(); return { ok: false, text: '' }; }
  }

  async function loadCss() {
    var r = await getText(CSS + '?t=' + Date.now());
    if (r.ok && r.text.length > 500) { css = r.text; ls('tcd_css', css); }
  }

  // ---------- Lecture de la Dalle ----------
  async function refresh() {
    if (!k || busy) return; busy = true;
    try {
      var r = await getText(BASE + q());
      if (r.ok && r.text.indexOf('<div class="top">') >= 0) {
        if (!css) await loadCss();
        lastOkAt = Date.now(); failSince = 0; ls('tcd_at', String(lastOkAt)); ls('tcd_last', r.text);
        show(r.text);
      } else if (r.ok && r.text.indexOf('class="code"') >= 0) {
        // Le serveur demande le code dalle : le code a changé, il faut jumeler l'iPad de nouveau.
        needPair('Le code dalle a changé : jumeler cet iPad de nouveau.');
      } else {
        fail();
      }
    } finally { busy = false; paint(); }
  }
  function fail() {
    if (!failSince) failSince = Date.now();
    var last = ls('tcd_last');
    // Pendant une coupure : si un bouton a mené vers une page qui n'a pas pu charger, on remet la dernière Dalle.
    if (last && navigated()) show(last);
    $('dvh').classList.remove('on');
  }

  // ---------- Alarmes sonores ----------
  function tone(f, t0, d, type, vol) { var o = ctx.createOscillator(), g = ctx.createGain(); o.type = type || 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.6, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d); o.connect(g); g.connect(ctx.destination); o.start(t0); o.stop(t0 + d + 0.05); }
  function shelfSound() { var t = ctx.currentTime + 0.05; for (var r = 0; r < 3; r++) { tone(988, t, 0.35, 'triangle', 0.8); tone(784, t + 0.4, 0.5, 'triangle', 0.8); t += 1.1; } }
  function callSound() { var t = ctx.currentTime + 0.05; for (var r = 0; r < 3; r++) { for (var i = 0; i < 12; i++) tone(i % 2 ? 480 : 440, t + i * 0.05, 0.05, 'square', 0.35); t += 0.95; } }
  function say(txt, delay) { setTimeout(function () { try { if (!window.speechSynthesis) return; var u = new SpeechSynthesisUtterance(txt); u.lang = 'fr-CA'; speechSynthesis.speak(u); } catch (e) {} }, delay || 0); }

  async function alarm() {
    if (!k) return;
    var r = await getText(API + '?k=' + encodeURIComponent(k) + '&t=' + Date.now());
    var d = null; try { d = JSON.parse(r.text); } catch (e) {}
    if (!d || !d.ok) { if (d && d.err === 'AUTH') needPair('Le code dalle a changé : jumeler cet iPad de nouveau.'); return; }
    lastAlarm = d; paint();
    if (!on || !ctx) return;
    try { if (ctx.state !== 'running') await ctx.resume(); } catch (e) {}
    if (ctx.state !== 'running') { off('Le son a été coupé par l’iPad'); return; }
    var now = Date.now();
    if (d.call > 0 && now >= nextCall) { callSound(); say(d.call > 1 ? d.call + ' clients à téléphoner' : 'Téléphoner le client', 3000); nextCall = now + REPEAT; nextShelf = Math.max(nextShelf, now + 6000); }
    else if (d.shelf > 0 && now >= nextShelf) { shelfSound(); say((d.shelf > 1 ? d.shelf + ' commandes prêtes depuis ' + d.shelfMin + ' minutes' : 'Commande prête depuis ' + d.oldest + ' minutes') + '. Il faut que ça parte!', 3400); nextShelf = now + REPEAT; }
    if (!d.call) nextCall = 0; if (!d.shelf) nextShelf = 0;
  }

  // ---------- Bandeau du bas ----------
  function paint() {
    var s = $('st'); if (!k) { s.hidden = true; return; } s.hidden = false;
    if (failSince && Date.now() - failSince > 15000) {
      var min = Math.max(1, Math.round((Date.now() - failSince) / 60000));
      s.className = 'bad';
      s.textContent = '⚠ Hors ligne depuis ' + min + ' min' + (lastOkAt ? ' · Dalle de ' + hm(lastOkAt) : '') + ' · reconnexion automatique…';
      return;
    }
    var d = lastAlarm;
    if (d && (d.call || d.shelf)) { s.className = 'al'; s.textContent = '🔔 ' + (d.shelf ? d.shelf + ' sur la dalle depuis ' + d.shelfMin + ' min' : '') + (d.shelf && d.call ? ' · ' : '') + (d.call ? d.call + ' à téléphoner' : ''); return; }
    s.className = ''; s.innerHTML = esc(on ? '🔊 Son activé' : '🔇 Son coupé') + ' <span class="n">· en ligne</span>';
  }

  function tick() { refresh(); alarm(); }
  function start() { if (timer) clearInterval(timer); timer = setInterval(tick, TICK); tick(); paint(); }
  function off(msg) { on = false; $('ovt').textContent = msg || 'Les alarmes sonores sont coupées'; $('go').textContent = 'Toucher pour activer le son'; $('ov').style.display = 'flex'; paint(); }

  // ---------- Jumelage (le code dalle est entré sur l'iPad par l'équipe) ----------
  function needPair(msg) {
    if (timer) { clearInterval(timer); timer = null; }
    k = ''; ls('tcd_k', null);
    $('ov').style.display = 'none';
    var p = $('pair'); p.style.display = 'block'; p.src = BASE + '?app=1&t=' + Date.now();
    paint();
  }
  function setK(v) {
    v = String(v || '').trim(); if (!v) return;
    k = v; ls('tcd_k', k); ls('tcd_last', null); lastOkAt = 0; failSince = 0;
    var p = $('pair'); p.style.display = 'none'; p.src = 'about:blank';
    $('ovt').textContent = 'iPad jumelé ✔ Toucher pour démarrer'; $('ov').style.display = on ? 'none' : 'flex';
    start();
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin) return;
    var d = e.data; if (d && typeof d === 'object' && d.dalleK) setK(d.dalleK);
  });

  // ---------- Boutons de la Dalle qui passent par les cadres cachés ----------
  function toggle(ch) { if (!ready) return; view = view.indexOf(ch) >= 0 ? view.replace(ch, '') : view + ch; view = 'w' + (view.indexOf('c') >= 0 ? 'c' : '') + (view.indexOf('r') >= 0 ? 'r' : ''); ls('tcd_view', view); refresh(); }
  $('dvh').onload = function () { if (ready && $('dvh').src && $('dvh').src !== 'about:blank') $('dvh').classList.add('on'); };
  $('dvl').onload = function () { if (!ready) return; $('dvh').classList.remove('on'); refresh(); };
  $('dvc').onload = function () { toggle('c'); };
  $('dvr').onload = function () { toggle('r'); };
  setTimeout(function () { ready = true; }, 1500);

  // ---------- Écran garde-allumé ----------
  async function keepAwake() { try { if (navigator.wakeLock && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', function () { wake = null; }); } } catch (e) { wake = null; } }

  $('go').addEventListener('click', function () {
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); tone(880, ctx.currentTime + 0.02, 0.15, 'sine', 0.4); } catch (e) {}
    say('Alarmes activées');
    on = true; $('ov').style.display = 'none'; keepAwake(); paint();
    if (k) tick();
  });

  // ---------- Menu ⋯ ----------
  var unArm = 0;
  $('mb').addEventListener('click', function () {
    $('minfo').textContent = 'Version ' + APP_VERSION + (lastOkAt ? ' · dernière Dalle reçue à ' + hm(lastOkAt) : '') + (failSince ? ' · hors ligne' : '');
    $('mun').textContent = 'Retirer le jumelage'; unArm = 0;
    $('menu').style.display = 'flex';
  });
  $('mclose').addEventListener('click', function () { $('menu').style.display = 'none'; });
  $('mrel').addEventListener('click', function () { $('menu').style.display = 'none'; location.reload(); });
  $('mtest').addEventListener('click', function () {
    $('menu').style.display = 'none';
    try { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); on = true; shelfSound(); say('Test des alarmes de la Dalle', 3400); } catch (e) {}
    paint();
  });
  $('mun').addEventListener('click', function () {
    if (Date.now() - unArm > 4000) { unArm = Date.now(); $('mun').textContent = 'Toucher encore pour confirmer'; return; }
    $('menu').style.display = 'none'; ls('tcd_last', null); ls('tcd_at', null); needPair('');
  });

  window.addEventListener('online', function () { tick(); });
  window.addEventListener('offline', function () { if (!failSince) failSince = Date.now(); paint(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') { keepAwake(); tick(); } });
  setInterval(paint, 30000);

  // ---------- Démarrage ----------
  if (!k) { needPair(''); return; }
  var last = ls('tcd_last');
  if (last) { show(last); if (!navigator.onLine) failSince = Date.now(); }
  start();
})();
