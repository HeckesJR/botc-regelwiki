/* ============================================================
   termine.js — Terminabfragen für die Runde

   Anders als alles andere im Wiki liegen diese Daten NICHT auf dem
   Gerät, sondern beim Dienst in worker/. Geteilte Umfragen brauchen
   einen gemeinsamen Ort. Hier bleiben nur drei Dinge lokal: das
   Gruppenwort, eine Zufallskennung und der eigene Name.
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  /* Beim Entwickeln läuft der Dienst nebenan, im Betrieb bei Cloudflare.
     Die Adresse unten wird nach dem ersten `wrangler deploy` eingetragen. */
  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:8787'
    : 'https://botc-termine.HIER-EINTRAGEN.workers.dev';

  var KEY = 'botc-regelwiki:termine:v1';

  var ROLLEN = [
    { id: 'spielleiter',      kurz: 'Spielleiter',   lang: 'Ich leite' },
    { id: 'spieler',          kurz: 'Spieler',       lang: 'Ich spiele mit' },
    { id: 'spieler_notfalls', kurz: 'Notfall-Leiter', lang: 'Ich spiele — kann aber notfalls leiten' }
  ];

  var ANTWORTEN = [
    { id: 'ja',         label: 'Ja' },
    { id: 'vielleicht', label: 'Vielleicht' },
    { id: 'nein',       label: 'Nein' }
  ];

  var lokal = ladeLokal();
  var sicht = { modus: 'liste', pollId: '', poll: null, liste: null, laedt: false, fehler: '' };
  var entwurf = null;   /* offenes Formular beim Anlegen */

  var esc = function (s) { return BOTC.esc(s); };

  /* ---------------------------------------------- Lokales */

  function ladeLokal() {
    try {
      var roh = localStorage.getItem(KEY);
      if (roh) {
        var p = JSON.parse(roh);
        if (p && typeof p === 'object') {
          if (!p.voterId) p.voterId = neueKennung();
          return p;
        }
      }
    } catch (e) { console.warn('Termine-Einstellungen nicht lesbar:', e); }
    return { gruppenwort: '', voterId: neueKennung(), name: '' };
  }

  function sichereLokal() {
    try { localStorage.setItem(KEY, JSON.stringify(lokal)); }
    catch (e) { console.warn('Termine-Einstellungen nicht speicherbar:', e); }
  }

  function neueKennung() {
    var b = new Uint8Array(12);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) {
      return ('0' + x.toString(16)).slice(-2);
    }).join('');
  }

  /* ---------------------------------------------- Dienst ansprechen */

  function req(pfad, opts) {
    opts = opts || {};
    var kopf = { 'X-Gruppenwort': lokal.gruppenwort || '' };
    if (opts.body) kopf['Content-Type'] = 'application/json';

    return fetch(API + pfad, {
      method: opts.body ? 'POST' : 'GET',
      headers: kopf,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (daten) {
        if (!res.ok) {
          var e = new Error(daten.fehler || ('Der Dienst antwortet mit ' + res.status + '.'));
          e.status = res.status;
          throw e;
        }
        return daten;
      });
    }).catch(function (e) {
      if (e.status) throw e;
      /* Kein Status heißt: gar nicht erst angekommen */
      var off = new Error('Keine Verbindung zum Terminplaner. Ohne Netz geht das nicht.');
      off.offline = true;
      throw off;
    });
  }

  /* ---------------------------------------------- Datum */

  var TAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
  function zwei(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDatum(iso) {
    var d = new Date(iso.length <= 10 ? iso + 'T00:00' : iso);
    if (isNaN(d.getTime())) return iso;
    var s = TAGE[d.getDay()] + ', ' + zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear();
    if (iso.length > 10) s += ' · ' + zwei(d.getHours()) + ':' + zwei(d.getMinutes());
    return s;
  }

  /* ---------------------------------------------- Die Ampel

     Der Kern des Ganzen. Blood on the Clocktower braucht mindestens
     fünf Spieler UND jemanden, der leitet — und der Leiter spielt nicht
     mit. Aus fünf Zusagen wird also eine Runde mit vier Spielern, und
     die fällt aus. Genau das verschweigt eine normale Terminumfrage. */

  /* „1 Scherge" statt „1 Schergen", und Nullen weglassen — bei sieben
     Spielern gibt es keine Außenseiter, das muss man nicht hinschreiben. */
  function verteilungstext(spieler) {
    var d = BOTC.baseDistribution(spieler);
    var teile = [
      [d.townsfolk,  'Bürger',       'Bürger'],
      [d.outsider,   'Außenseiter',  'Außenseiter'],
      [d.minion,     'Scherge',      'Schergen'],
      [d.demon,      'Dämon',        'Dämonen'],
      [d.travellers, 'Reisender',    'Reisende']
    ];
    return teile
      .filter(function (t) { return t[0] > 0; })
      .map(function (t) { return t[0] + ' ' + (t[0] === 1 ? t[1] : t[2]); })
      .join(' · ');
  }

  function lage(poll, optionId) {
    var nachKennung = {};
    poll.teilnehmer.forEach(function (t) { nachKennung[t.voter_id] = t; });

    var stimmen = poll.stimmen.filter(function (s) { return s.option_id === optionId; });
    var ja = stimmen.filter(function (s) { return s.antwort === 'ja'; })
                    .map(function (s) { return nachKennung[s.voter_id]; })
                    .filter(Boolean);
    var vielleicht = stimmen.filter(function (s) { return s.antwort === 'vielleicht'; })
                    .map(function (s) { return nachKennung[s.voter_id]; })
                    .filter(Boolean);

    var leiter   = ja.filter(function (t) { return t.rolle === 'spielleiter'; });
    var notfalls = ja.filter(function (t) { return t.rolle === 'spieler_notfalls'; });
    var hatLeitung = leiter.length > 0 || notfalls.length > 0;

    /* Wer leitet, spielt nicht mit */
    var spieler = hatLeitung ? ja.length - 1 : ja.length;

    var l = {
      zusagen: ja.length,
      vielleicht: vielleicht.length,
      namenJa: ja.map(function (t) { return t.name; }),
      namenVielleicht: vielleicht.map(function (t) { return t.name; }),
      leiter: leiter, notfalls: notfalls,
      spieler: spieler,
      fehlen: Math.max(0, BOTC.MIN_PLAYERS - spieler)
    };

    if (spieler > BOTC.MAX_PLAYERS) {
      l.stufe = 'warn';
      l.text = spieler + ' Spieler — mehr als ' + BOTC.MAX_PLAYERS +
               ' gehen nicht. Zwei Runden oder Reisende einsetzen.';
    } else if (!hatLeitung) {
      l.stufe = ja.length >= BOTC.MIN_PLAYERS ? 'gelb' : 'rot';
      l.text = ja.length + ' Zusagen, aber niemand leitet.' +
               (ja.length >= BOTC.MIN_PLAYERS ? ' Es fehlt nur der Spielleiter.' : '');
    } else if (spieler < BOTC.MIN_PLAYERS) {
      l.stufe = 'rot';
      l.text = spieler + ' Spieler + Leitung — ' +
               (l.fehlen === 1 ? 'es fehlt noch einer.' : 'es fehlen noch ' + l.fehlen + '.');
    } else if (leiter.length === 0) {
      l.stufe = 'gelb';
      l.text = spieler + ' Spieler, aber kein fester Spielleiter. ' +
               notfalls.map(function (t) { return t.name; }).join(' oder ') + ' könnte notfalls.';
    } else {
      l.stufe = 'gruen';
      l.text = spieler + ' Spieler, ' + leiter[0].name + ' leitet.';
      l.verteilung = verteilungstext(spieler);
    }

    return l;
  }

  /* ---------------------------------------------- Ansichten */

  function wurzel() { return document.getElementById('termine-root'); }

  function zeichne(html) {
    var r = wurzel();
    if (r) r.innerHTML = html;
  }

  function ladebalken(was) {
    return '<p class="loading">' + esc(was || 'Wird geladen …') + '</p>';
  }

  function fehlerKasten(nachricht) {
    return '<p class="note note--warn">' + esc(nachricht) + '</p>';
  }

  /* Gruppenwort-Abfrage. Ohne das geht hier gar nichts, auch kein Lesen. */
  function zeichneTor(meldung) {
    zeichne(
      '<div class="tor">' +
        '<h3 class="tor__titel">Gruppenwort</h3>' +
        '<p class="tor__text">Die Terminplanung ist nur für unsere Runde. ' +
          'Das Wort wird einmal eingegeben und danach auf diesem Gerät gemerkt.</p>' +
        (meldung ? fehlerKasten(meldung) : '') +
        '<form class="tor__form" id="tor-form">' +
          '<input type="password" id="tor-wort" placeholder="Gruppenwort" autocomplete="current-password">' +
          '<button type="submit" class="btn btn--primary">Weiter</button>' +
        '</form>' +
      '</div>'
    );
    var feld = document.getElementById('tor-wort');
    if (feld) feld.focus();
  }

  function zeichneListe() {
    var l = sicht.liste || [];
    var offen = l.filter(function (p) { return p.status === 'offen'; });
    var rest  = l.filter(function (p) { return p.status !== 'offen'; });

    var zeile = function (p) {
      var abzeichen = p.status === 'offen' ? '<span class="pill pill--offen">läuft</span>'
                    : p.status === 'entschieden' ? '<span class="pill pill--fest">steht</span>'
                    : '<span class="pill pill--ab">abgesagt</span>';
      return '<button type="button" class="pollrow" data-poll="' + esc(p.id) + '">' +
               '<span class="pollrow__titel">' + esc(p.titel) + '</span>' +
               '<span class="pollrow__meta">von ' + esc(p.erstellt_von) + '</span>' +
               abzeichen +
             '</button>';
    };

    zeichne(
      '<div class="termine-kopf">' +
        '<button type="button" class="btn btn--primary" data-act="neu">Neue Terminabfrage</button>' +
      '</div>' +
      (offen.length
        ? '<h3 class="section-sub">Läuft gerade</h3>' + offen.map(zeile).join('')
        : '<p class="empty-state">Gerade läuft keine Abfrage.</p>') +
      (rest.length ? '<h3 class="section-sub">Früher</h3>' + rest.map(zeile).join('') : '')
    );
  }

  function zeichneAnlegen() {
    var e = entwurf;
    var zeilen = e.optionen.map(function (o, i) {
      return '<div class="tvorschlag">' +
               '<input type="date" data-feld="datum" data-i="' + i + '" value="' + esc(o.datum) + '">' +
               '<input type="time" data-feld="zeit" data-i="' + i + '" value="' + esc(o.zeit) + '">' +
               '<input type="text" data-feld="label" data-i="' + i + '" value="' + esc(o.label) + '" ' +
                 'placeholder="Ort (optional)">' +
               (e.optionen.length > 1
                 ? '<button type="button" class="iconbtn iconbtn--del" data-act="weg" data-i="' + i + '" ' +
                   'aria-label="Vorschlag entfernen">✕</button>'
                 : '<span></span>') +
             '</div>';
    }).join('');

    zeichne(
      '<button type="button" class="btn btn--ghost btn--small" data-act="zurueck">← Übersicht</button>' +
      '<h3 class="section-sub">Neue Terminabfrage</h3>' +
      (sicht.fehler ? fehlerKasten(sicht.fehler) : '') +
      '<label class="field"><span class="field__label">Titel</span>' +
        '<input type="text" data-feld="titel" value="' + esc(e.titel) + '" ' +
        'placeholder="z. B. Runde im Oktober"></label>' +
      '<label class="field"><span class="field__label">Dein Name</span>' +
        '<input type="text" data-feld="von" value="' + esc(e.von) + '" placeholder="Wer fragt?"></label>' +
      '<span class="field__label">Terminvorschläge</span>' +
      '<div class="tvorschlaege">' + zeilen + '</div>' +
      '<button type="button" class="btn btn--ghost btn--small" data-act="mehr">+ Vorschlag</button>' +
      '<label class="field"><span class="field__label">Antworten bis (optional)</span>' +
        '<input type="date" data-feld="frist" value="' + esc(e.frist) + '"></label>' +
      '<div class="termine-aktionen">' +
        '<button type="button" class="btn btn--primary" data-act="anlegen">Abfrage starten</button>' +
      '</div>'
    );
  }

  function zeichneDetail() {
    var p = sicht.poll;
    if (!p) return;

    var ich = null;
    p.teilnehmer.forEach(function (t) { if (t.voter_id === lokal.voterId) ich = t; });
    var meineRolle = (ich && ich.rolle) || 'spieler';
    var meineAntworten = {};
    p.stimmen.forEach(function (s) {
      if (s.voter_id === lokal.voterId) meineAntworten[s.option_id] = s.antwort;
    });

    var kopf =
      '<button type="button" class="btn btn--ghost btn--small" data-act="zurueck">← Übersicht</button>' +
      '<h3 class="section-sub">' + esc(p.titel) + '</h3>' +
      '<p class="termine-meta">von ' + esc(p.erstellt_von) +
        (p.frist ? ' · Antworten bis ' + esc(fmtDatum(p.frist)) : '') +
        ' · ' + p.teilnehmer.length + ' haben abgestimmt</p>' +
      (p.status === 'abgesagt'
        ? fehlerKasten('Abgesagt.' + (p.notiz ? ' ' + p.notiz : ''))
        : '');

    var meins =
      '<div class="mein-block">' +
        '<label class="field"><span class="field__label">Dein Name</span>' +
          '<input type="text" data-feld="name" value="' + esc((ich && ich.name) || lokal.name) + '" ' +
          'placeholder="Wie heißt du?"></label>' +
        '<span class="field__label">Du kommst als</span>' +
        '<div class="chipset rollen">' +
          ROLLEN.map(function (r) {
            return '<button type="button" class="chip' + (r.id === meineRolle ? ' is-active' : '') +
                   '" data-rolle="' + r.id + '" aria-pressed="' +
                   (r.id === meineRolle) + '">' + esc(r.lang) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';

    var termine = p.optionen.map(function (o) {
      var l = lage(p, o.id);
      var meine = meineAntworten[o.id] || '';

      return '<div class="tblock" data-stufe="' + l.stufe + '">' +
        '<div class="tblock__kopf">' +
          '<strong class="tblock__datum">' + esc(fmtDatum(o.beginnt_am)) + '</strong>' +
          (o.label ? '<span class="tblock__ort">' + esc(o.label) + '</span>' : '') +
        '</div>' +

        '<p class="tblock__lage">' + esc(l.text) +
          (l.verteilung ? '<span class="tblock__verteilung">' + esc(l.verteilung) + '</span>' : '') +
        '</p>' +

        (l.namenJa.length
          ? '<p class="tblock__namen"><strong>Dabei:</strong> ' + esc(l.namenJa.join(', ')) + '</p>' : '') +
        (l.namenVielleicht.length
          ? '<p class="tblock__namen tblock__namen--vielleicht"><strong>Vielleicht:</strong> ' +
            esc(l.namenVielleicht.join(', ')) + '</p>' : '') +

        '<div class="seg antwortwahl">' +
          ANTWORTEN.map(function (a) {
            return '<button type="button" class="seg__btn' + (a.id === meine ? ' is-active' : '') +
                   '" data-antwort="' + a.id + '" data-option="' + esc(o.id) + '">' +
                   esc(a.label) + '</button>';
          }).join('') +
        '</div>' +
      '</div>';
    }).join('');

    zeichne(kopf + meins + '<div class="tbloecke">' + termine + '</div>' +
      '<div class="termine-aktionen">' +
        '<button type="button" class="btn btn--primary" data-act="speichern">Antwort speichern</button>' +
        '<button type="button" class="btn btn--ghost btn--small" data-act="neuladen">Stand aktualisieren</button>' +
        '<span class="termine-status" id="termine-status"></span>' +
      '</div>');
  }

  /* ---------------------------------------------- Ablauf */

  function zeige(sub) {
    if (!lokal.gruppenwort) { zeichneTor(''); return; }

    if (sub) {
      sicht.modus = 'detail';
      sicht.pollId = sub;
      ladeDetail();
    } else {
      sicht.modus = 'liste';
      ladeListe();
    }
  }

  /* leise = ohne Ladeanzeige und ohne Fehlerseite. Für das Nachladen im
     Hintergrund, damit nicht bei jedem Tabwechsel alles kurz weiß wird
     oder eine Fehlermeldung die gerade getippte Antwort wegräumt. */
  function ladeListe(leise) {
    if (!leise) zeichne(ladebalken('Abfragen werden geladen …'));
    req('/api/polls').then(function (d) {
      sicht.liste = d.polls || [];
      if (sicht.modus === 'liste') zeichneListe();
    }).catch(leise ? function () {} : zeigeFehler);
  }

  function ladeDetail(leise) {
    if (!leise) zeichne(ladebalken('Abfrage wird geladen …'));
    var id = sicht.pollId;
    req('/api/polls/' + encodeURIComponent(id)).then(function (p) {
      /* Zwischenzeitlich woanders hingeklickt? Dann nicht überschreiben. */
      if (sicht.modus !== 'detail' || sicht.pollId !== id) return;
      sicht.poll = p;
      zeichneDetail();
    }).catch(leise ? function () {} : zeigeFehler);
  }

  function zeigeFehler(e) {
    if (e.status === 401) {
      lokal.gruppenwort = '';
      sichereLokal();
      zeichneTor('Das Gruppenwort stimmt nicht mehr.');
      return;
    }
    zeichne(fehlerKasten(e.message) +
      '<button type="button" class="btn btn--ghost btn--small" data-act="zurueck">← Übersicht</button>');
  }

  function leererEntwurf() {
    return {
      titel: '', von: lokal.name || '', frist: '',
      optionen: [{ datum: '', zeit: '19:00', label: '' }]
    };
  }

  /* ---------------------------------------------- Verdrahtung */

  function init() {
    var r = wurzel();
    if (!r) return;

    r.addEventListener('submit', function (ev) {
      if (ev.target.id !== 'tor-form') return;
      ev.preventDefault();
      var wort = document.getElementById('tor-wort').value.trim();
      if (!wort) return;
      lokal.gruppenwort = wort;
      zeichne(ladebalken('Wird geprüft …'));
      req('/api/check').then(function () {
        sichereLokal();
        zeige(sicht.pollId);
      }).catch(function (e) {
        lokal.gruppenwort = '';
        zeichneTor(e.message);
      });
    });

    r.addEventListener('input', function (ev) {
      var f = ev.target.dataset.feld;
      if (!f) return;

      if (sicht.modus === 'anlegen' && entwurf) {
        var i = ev.target.dataset.i;
        if (i != null && entwurf.optionen[i]) entwurf.optionen[i][f] = ev.target.value;
        else if (f === 'titel' || f === 'von' || f === 'frist') entwurf[f] = ev.target.value;
        return;
      }
      if (f === 'name') { lokal.name = ev.target.value; sichereLokal(); }
    });

    r.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act], [data-poll], [data-rolle], [data-antwort]');
      if (!btn) return;

      if (btn.dataset.poll) {
        BOTC.gotoTab('termine', btn.dataset.poll);
        return;
      }

      if (btn.dataset.rolle) {
        btn.parentNode.querySelectorAll('.chip').forEach(function (c) {
          var on = c === btn;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-pressed', String(on));
        });
        return;
      }

      if (btn.dataset.antwort) {
        btn.parentNode.querySelectorAll('.seg__btn').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        return;
      }

      switch (btn.dataset.act) {
        case 'zurueck':
          BOTC.gotoTab('termine', '');
          break;

        case 'neu':
          sicht.modus = 'anlegen';
          sicht.fehler = '';
          entwurf = leererEntwurf();
          zeichneAnlegen();
          break;

        case 'mehr':
          if (entwurf.optionen.length < 8) {
            var letzte = entwurf.optionen[entwurf.optionen.length - 1];
            entwurf.optionen.push({ datum: '', zeit: letzte ? letzte.zeit : '19:00', label: '' });
            zeichneAnlegen();
          }
          break;

        case 'weg':
          entwurf.optionen.splice(Number(btn.dataset.i), 1);
          zeichneAnlegen();
          break;

        case 'anlegen':
          anlegen();
          break;

        case 'speichern':
          speichern();
          break;

        case 'neuladen':
          if (sicht.modus === 'detail') ladeDetail(); else ladeListe();
          break;
      }
    });

    /* Wer die Abfrage offen liegen lässt, sieht sonst einen Stand von vor
       einer Stunde. Beim Zurückkommen einmal nachladen — bewusst kein
       Dauerabruf im Sekundentakt, D1 liefert bei Überschreiten der
       Gratis-Grenzen seit September 2026 Fehler statt Verlangsamung. */
    function nachladenWennSichtbar() {
      if (document.hidden) return;
      var panel = document.getElementById('panel-termine');
      if (!panel || panel.hidden) return;
      if (!lokal.gruppenwort) return;
      if (sicht.modus === 'detail' && sicht.pollId) ladeDetail(true);
      else if (sicht.modus === 'liste') ladeListe(true);
    }

    document.addEventListener('visibilitychange', nachladenWennSichtbar);
    window.addEventListener('focus', nachladenWennSichtbar);
  }

  function anlegen() {
    var e = entwurf;
    var optionen = e.optionen
      .filter(function (o) { return o.datum; })
      .map(function (o) {
        return { beginnt_am: o.zeit ? o.datum + 'T' + o.zeit : o.datum, label: o.label };
      });

    if (!e.titel.trim())  { sicht.fehler = 'Die Abfrage braucht einen Titel.'; return zeichneAnlegen(); }
    if (!e.von.trim())    { sicht.fehler = 'Trag deinen Namen ein.'; return zeichneAnlegen(); }
    if (!optionen.length) { sicht.fehler = 'Mindestens ein Datum angeben.'; return zeichneAnlegen(); }

    sicht.fehler = '';
    zeichne(ladebalken('Wird angelegt …'));

    req('/api/polls', { body: {
      titel: e.titel, erstellt_von: e.von, frist: e.frist, optionen: optionen
    }}).then(function (p) {
      lokal.name = e.von;
      sichereLokal();
      entwurf = null;
      BOTC.gotoTab('termine', p.id);
    }).catch(function (err) {
      sicht.fehler = err.message;
      zeichneAnlegen();
    });
  }

  function speichern() {
    var p = sicht.poll;
    if (!p) return;

    var nameFeld = wurzel().querySelector('[data-feld="name"]');
    var name = nameFeld ? nameFeld.value.trim() : '';
    var status = document.getElementById('termine-status');

    if (!name) {
      if (status) status.textContent = 'Bitte trag deinen Namen ein.';
      if (nameFeld) nameFeld.focus();
      return;
    }

    var rolleBtn = wurzel().querySelector('.rollen .chip.is-active');
    var rolle = rolleBtn ? rolleBtn.dataset.rolle : 'spieler';

    var antworten = {};
    wurzel().querySelectorAll('.antwortwahl .seg__btn.is-active').forEach(function (b) {
      antworten[b.dataset.option] = b.dataset.antwort;
    });

    if (status) status.textContent = 'Wird gespeichert …';

    req('/api/polls/' + encodeURIComponent(p.id) + '/vote', { body: {
      voter_id: lokal.voterId, name: name, rolle: rolle, antworten: antworten
    }}).then(function (neu) {
      lokal.name = name;
      sichereLokal();
      sicht.poll = neu;
      zeichneDetail();
      var s = document.getElementById('termine-status');
      if (s) {
        s.textContent = 'Gespeichert.';
        setTimeout(function () { if (s.textContent === 'Gespeichert.') s.textContent = ''; }, 3000);
      }
    }).catch(function (err) {
      var s = document.getElementById('termine-status');
      if (s) s.textContent = err.message;
    });
  }

  BOTC.termine = { init: init, show: zeige, lage: lage, fmtDatum: fmtDatum };

})(window.BOTC);
