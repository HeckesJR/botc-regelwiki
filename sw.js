/* ============================================================
   sw.js — Service Worker für den Offline-Betrieb

   Grundgedanke: Ein Service Worker liefert notorisch alte Stände aus.
   Deshalb ist hier nichts blind zwischengespeichert, sondern nach
   Dateiart getrennt:

     Texte (HTML, JS, CSS, JSON)   -> zuerst Netz, Cache nur als Rückfall
     Bilder & Schriften            -> zuerst Cache, das spart die Masse

   Damit bekommst du online IMMER die frischen Inhalte. Nur wenn kein
   Netz da ist, springt der Cache ein. Die Bilder ändern sich praktisch
   nie und machen 3,4 der 5,9 MB aus — die dürfen aus dem Cache kommen.

   ------------------------------------------------------------
   WICHTIG BEIM ÄNDERN VON BILDERN, ICONS ODER SCHRIFTEN:
   VERSION unten hochzählen. Sonst behalten alle, die die Seite schon
   einmal geöffnet haben, die alten Bilder — unbegrenzt lange.
   Für Änderungen an HTML, JS, CSS und den JSON-Daten ist das NICHT
   nötig, die kommen ohnehin frisch aus dem Netz.
   ------------------------------------------------------------
   ============================================================ */

var VERSION = 'v1';
var CACHE = 'botc-regelwiki-' + VERSION;

/* Alles, was die Seite zum Starten braucht. Wird bei der Installation
   geholt, damit der erste Offline-Start funktioniert. Die 198
   Charakter-Icons sind bewusst NICHT dabei — die kämen einzeln nach und
   würden die Installation unnötig lange blockieren. Sie landen im Cache,
   sobald sie das erste Mal angezeigt wurden. */
var SHELL = [
  './',
  'index.html',
  '404.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/render.js',
  'js/search.js',
  'js/generator.js',
  'js/scripts.js',
  'js/notes.js',
  'js/termine.js',
  'js/pdf-export.js',
  'js/app.js',
  'vendor/jspdf.umd.min.js',
  'data/grundregeln_de.json',
  'data/glossar_de.json',
  'data/trouble_brewing.json',
  'data/bad_moon_rising.json',
  'data/sects_violets.json',
  'data/traveller_fabled.json',
  'data/balance.json',
  'assets/textures/parchment.svg',
  'assets/textures/fleuron.svg',
  'assets/textures/corner.svg',
  'assets/brand/ccc-sleeve.png',
  'assets/icons/app/icon-180.png',
  'assets/icons/app/icon-192.png',
  'assets/icons/app/icon-512.png',
  'assets/icons/app/icon-maskable-512.png'
];

/* Nach dieser Zeit gilt das Netz als tot und der Cache übernimmt.
   Ohne das hängt die Seite bei schlechtem Empfang minutenlang. */
var NETWORK_TIMEOUT = 4000;

/* ---------------------------------------------- Installation */

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (cache) {
      /* Einzeln statt cache.addAll(): eine fehlende Datei würde sonst die
         komplette Installation scheitern lassen. */
      return Promise.all(SHELL.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function (e) {
          console.warn('[sw] nicht vorgeladen:', url, e.message);
        });
      }));
    })
  );
});

/* ---------------------------------------------- Aktivierung */

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* Die Seite bittet um sofortige Übernahme, wenn der Nutzer auf
   „Neu laden" geklickt hat. */
self.addEventListener('message', function (ev) {
  if (ev.data === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------------------------------------------- Strategien */

function fromNetworkFirst(req) {
  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      caches.match(req).then(function (hit) { resolve(hit || fetch(req)); });
    }, NETWORK_TIMEOUT);

    fetch(req).then(function (res) {
      clearTimeout(timer);
      if (settled) {
        /* Der Cache war schneller, die Antwort trotzdem für nächstes Mal ablegen */
        if (res && res.ok) caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        return;
      }
      settled = true;
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      resolve(res);
    }).catch(function () {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      caches.match(req).then(function (hit) {
        resolve(hit || new Response(
          '<!doctype html><meta charset="utf-8"><title>Offline</title>' +
          '<body style="font-family:Georgia,serif;background:#efe4cc;color:#2b2117;' +
          'padding:2rem;text-align:center"><h1>Kein Netz</h1>' +
          '<p>Diese Seite war noch nicht im Speicher. Einmal mit Empfang öffnen, ' +
          'danach geht sie auch offline.</p>',
          { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        ));
      });
    });
  });
}

function fromCacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      /* Auch undurchsichtige Antworten (Google Fonts) ablegen — man kann sie
         nicht prüfen, aber ohne sie fehlt offline die Schrift. */
      if (res && (res.ok || res.type === 'opaque')) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    });
  });
}

var IMAGE_LIKE = /\.(webp|png|jpe?g|svg|woff2?|ttf)$/i;

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  /* Google Fonts: Stylesheet und Schriftdateien dürfen aus dem Cache kommen,
     sonst steht die Seite offline im Palatino-Rückfall. */
  if (!sameOrigin) {
    if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
      ev.respondWith(fromCacheFirst(req));
    }
    return;
  }

  if (IMAGE_LIKE.test(url.pathname)) {
    ev.respondWith(fromCacheFirst(req));
    return;
  }

  ev.respondWith(fromNetworkFirst(req));
});
