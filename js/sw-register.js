/* ============================================================
   sw-register.js — Service Worker anmelden und Updates sichtbar machen

   Der unangenehme Teil an Service Workern ist nicht das Offline-Können,
   sondern dass sie stumm alte Stände ausliefern. Deshalb gibt es hier
   eine Leiste am unteren Rand, sobald eine neue Fassung bereitsteht.
   Ohne Klick passiert nichts — niemand verliert mitten im Spiel seine
   Notizen, nur weil gerade ein Update kam.
   ============================================================ */

(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  /* Über file:// gibt es keine Service Worker, und beim Entwickeln stört er nur. */
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;

  var reloading = false;

  function showUpdateBar(worker) {
    if (document.getElementById('sw-update')) return;

    var bar = document.createElement('div');
    bar.id = 'sw-update';
    bar.className = 'sw-update';
    bar.setAttribute('role', 'status');
    bar.innerHTML =
      '<span class="sw-update__text">Eine neue Fassung des Regelwikis ist da.</span>' +
      '<button type="button" class="btn btn--small" id="sw-update-go">Jetzt laden</button>' +
      '<button type="button" class="btn btn--ghost btn--small" id="sw-update-later">Später</button>';
    document.body.appendChild(bar);

    document.getElementById('sw-update-go').addEventListener('click', function () {
      worker.postMessage('SKIP_WAITING');
    });
    document.getElementById('sw-update-later').addEventListener('click', function () {
      bar.remove();
    });
  }

  /* Der neue Service Worker hat übernommen — jetzt ist ein Neuladen sinnvoll. */
  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {

      /* Wartet schon eine neue Fassung aus einem früheren Besuch? */
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);

      reg.addEventListener('updatefound', function () {
        var neu = reg.installing;
        if (!neu) return;
        neu.addEventListener('statechange', function () {
          /* installed + vorhandener Controller = Update, nicht Erstinstallation */
          if (neu.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateBar(neu);
          }
        });
      });

      /* Browser prüfen sw.js von sich aus nur sporadisch. Einmal beim Laden
         und danach stündlich nachfragen, damit ein Push nicht tagelang
         unbemerkt bleibt. */
      reg.update();
      setInterval(function () { reg.update(); }, 60 * 60 * 1000);

    }).catch(function (e) {
      console.warn('[sw] Registrierung fehlgeschlagen:', e);
    });
  });

})();
