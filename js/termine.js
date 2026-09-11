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

  /* Beim Entwickeln läuft der Dienst nebenan (wrangler dev --local),
     im Betrieb bei Cloudflare. Ändert sich die Adresse, muss sie hier
     angepasst und die Seite neu gepusht werden. */
  var API = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://127.0.0.1:8787'
    : 'https://botc-termine.janheckwolf.workers.dev';

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

  /* Muss zum Limit im Worker passen. Ein Monat kann 5 Freitage UND
     5 Samstage haben, 8 waren dafür zu knapp. */
  var MAX_OPTIONEN = 12;

  var MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
                'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  /* getDay(): 0 = Sonntag. Angezeigt wird aber ab Montag. */
  var WOCHENTAGE = [
    { n: 1, k: 'Mo' }, { n: 2, k: 'Di' }, { n: 3, k: 'Mi' }, { n: 4, k: 'Do' },
    { n: 5, k: 'Fr' }, { n: 6, k: 'Sa' }, { n: 0, k: 'So' }
  ];

  var nameTimer = null;
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
    } else if (ja.length === 0) {
      l.stufe = 'rot';
      l.text = 'Noch keine Zusagen.';
    } else if (!hatLeitung) {
      l.stufe = ja.length >= BOTC.MIN_PLAYERS ? 'gelb' : 'rot';
      l.text = ja.length + (ja.length === 1 ? ' Zusage' : ' Zusagen') + ', aber niemand leitet.' +
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

  /* ---------------------------------------------- Banner auf allen Tabs

     Liegt über den Tabs und ist deshalb überall sichtbar. Es fragt genau
     einmal beim Laden nach und danach nur noch, wenn sich etwas geändert
     hat oder man zur Seite zurückkommt — kein Abruf im Sekundentakt. */

  var UHR_SVG =
    '<svg class="banner__icon" viewBox="0 0 24 24" width="20" height="20" fill="none" ' +
    'stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';

  function bannerEl() { return document.getElementById('termine-banner'); }

  function ladeBanner() {
    var el = bannerEl();
    if (!el) return;
    if (!lokal.gruppenwort) { el.hidden = true; el.innerHTML = ''; return; }

    req('/api/current').then(function (d) {
      zeichneBanner(d);
    }).catch(function () {
      /* Kein Netz oder Wort abgelaufen: lieber nichts zeigen als etwas Falsches */
      el.hidden = true;
      el.innerHTML = '';
    });
  }

  function zeichneBanner(d) {
    var el = bannerEl();
    if (!el) return;

    var zeilen = [];

    if (d.termin) {
      zeilen.push(
        '<button type="button" class="banner__zeile banner__zeile--fest" ' +
          'data-banner="' + esc(d.termin.id) + '">' +
          UHR_SVG +
          '<span class="banner__text"><strong>Nächste Runde:</strong> ' +
            esc(fmtDatum(d.termin.beginnt_am)) +
            (d.termin.label ? ' · ' + esc(d.termin.label) : '') +
            ' — ' + d.termin.zusagen + (d.termin.zusagen === 1 ? ' Zusage' : ' Zusagen') +
          '</span>' +
          '<span class="banner__mehr">Ansehen</span>' +
        '</button>');
    }

    if (d.umfrage) {
      var u = d.umfrage;
      zeilen.push(
        '<button type="button" class="banner__zeile" data-banner="' + esc(u.id) + '">' +
          UHR_SVG +
          '<span class="banner__text"><strong>Terminabfrage läuft:</strong> ' +
            esc(u.titel) + ' · ' + u.anzahl_optionen +
            (u.anzahl_optionen === 1 ? ' Vorschlag' : ' Vorschläge') + ' · ' +
            u.anzahl_teilnehmer +
            (u.anzahl_teilnehmer === 1 ? ' hat abgestimmt' : ' haben abgestimmt') +
            (u.frist ? ' · bis ' + esc(fmtDatum(u.frist)) : '') +
          '</span>' +
          '<span class="banner__mehr">Abstimmen</span>' +
        '</button>');
    }

    el.innerHTML = zeilen.join('');
    el.hidden = zeilen.length === 0;
  }

  /* ---------------------------------------------- WhatsApp-Text */

  function seitenLink(pollId) {
    return location.origin + location.pathname + '#termine/' + pollId;
  }

  function whatsappText(poll) {
    var zeilen = [];

    if (poll.status === 'entschieden') {
      var fest = null;
      poll.optionen.forEach(function (o) { if (o.id === poll.entschieden_option) fest = o; });
      var l = fest ? lage(poll, fest.id) : null;

      zeilen.push('🕰 Der Termin steht!');
      zeilen.push('');
      zeilen.push('Blood on the Clocktower — ' + (fest ? fmtDatum(fest.beginnt_am) : '?'));
      if (fest && fest.label) zeilen.push(fest.label);
      zeilen.push('');
      if (l) {
        zeilen.push('Dabei (' + l.zusagen + '): ' + l.namenJa.join(', '));
        if (l.leiter.length) zeilen.push(l.leiter[0].name + ' leitet.');
        else if (l.notfalls.length) zeilen.push('Achtung: noch kein fester Spielleiter!');
      }
      zeilen.push('');
      zeilen.push('Details: ' + seitenLink(poll.id));

    } else if (poll.status === 'abgesagt') {
      zeilen.push('🕰 Der Termin fällt aus.');
      zeilen.push('');
      zeilen.push('„' + poll.titel + '"');
      if (poll.notiz) zeilen.push(poll.notiz);
      zeilen.push('');
      /* Auf die Übersicht, nicht auf die abgesagte Abfrage — dort kann man
         gleich eine neue starten. */
      zeilen.push('Neue Abfrage starten: ' + location.origin + location.pathname + '#termine');

    } else {
      zeilen.push('🕰 Neue Terminabfrage für Blood on the Clocktower');
      zeilen.push('');
      zeilen.push('„' + poll.titel + '" — ' + poll.optionen.length +
                  (poll.optionen.length === 1 ? ' Vorschlag:' : ' Vorschläge:'));
      poll.optionen.forEach(function (o) {
        zeilen.push('• ' + fmtDatum(o.beginnt_am) + (o.label ? ' (' + o.label + ')' : ''));
      });
      zeilen.push('');
      zeilen.push('Bitte eintragen, ob ihr mitspielen könnt:');
      zeilen.push(seitenLink(poll.id));
      zeilen.push('');
      zeilen.push('Stand: ' + poll.teilnehmer.length +
                  (poll.teilnehmer.length === 1 ? ' hat' : ' haben') + ' abgestimmt' +
                  (poll.frist ? ' · Antworten bis ' + fmtDatum(poll.frist) : ''));
    }

    return zeilen.join('\n');
  }

  /* Overlay statt stiller Kopie: Das Kopieren scheitert auf manchen Geräten
     ohne Rückmeldung. So sieht man den Text immer und kann ihn notfalls von
     Hand markieren. */
  function zeigeTextZumKopieren(text) {
    var alt = document.getElementById('wa-overlay');
    if (alt) alt.remove();

    var o = document.createElement('div');
    o.className = 'sheetover';
    o.id = 'wa-overlay';
    o.innerHTML =
      '<div class="sheetover__panel" role="dialog" aria-modal="true" aria-label="Text für WhatsApp">' +
        '<div class="sheetover__head">' +
          '<h3>Text für WhatsApp</h3>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-wa-close>Fertig</button>' +
        '</div>' +
        '<p class="sheetover__hint" id="wa-hinweis">In die Gruppe einfügen.</p>' +
        '<div class="sheetover__body">' +
          '<textarea class="wa-text" id="wa-text" rows="14" readonly></textarea>' +
          '<button type="button" class="btn btn--primary" data-wa-kopieren>Nochmal kopieren</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(o);
    document.body.classList.add('is-locked');
    document.getElementById('wa-text').value = text;

    kopiereInZwischenablage(text);
  }

  function kopiereInZwischenablage(text) {
    var hinweis = document.getElementById('wa-hinweis');
    var melde = function (s) { if (hinweis) hinweis.textContent = s; };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        melde('Kopiert — in die Gruppe einfügen.');
      }).catch(function () {
        melde('Kopieren hat nicht geklappt. Text unten markieren und von Hand kopieren.');
      });
    } else {
      melde('Text unten markieren und kopieren.');
    }
  }

  /* ---------------------------------------------- Kalendereintrag

     Eine .ics-Datei, die jeder Handykalender versteht. Ohne Zeitzone —
     das ist bei einem Treffen vor Ort genau richtig, der Termin gilt in
     der Ortszeit des Geräts. */

  var ABEND_STUNDEN = 4;   /* So lange dauert eine Runde ungefähr */

  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  }

  function icsStempel() {
    return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  }

  /* RFC 5545 erlaubt höchstens 75 Oktetts je Zeile; längere werden umbrochen
     und mit einem Leerzeichen fortgesetzt. Gezählt wird in Bytes, nicht in
     Zeichen — sonst zerreißt es Umlaute mitten im Buchstaben. */
  function icsFalte(zeile) {
    var enc = new TextEncoder();
    if (enc.encode(zeile).length <= 75) return zeile;

    var teile = [], puffer = '', bytes = 0, grenze = 75;

    for (var i = 0; i < zeile.length; i++) {
      /* Ersatzpaare (z. B. Emoji) dürfen nicht getrennt werden */
      var zeichen = zeile[i];
      var code = zeile.charCodeAt(i);
      if (code >= 0xD800 && code <= 0xDBFF && i + 1 < zeile.length) {
        zeichen += zeile[i + 1];
        i++;
      }
      var n = enc.encode(zeichen).length;
      if (bytes + n > grenze) {
        teile.push(puffer);
        puffer = ' ' + zeichen;      /* Fortsetzung beginnt mit Leerzeichen */
        bytes = 1 + n;
        grenze = 75;
      } else {
        puffer += zeichen;
        bytes += n;
      }
    }
    if (puffer) teile.push(puffer);
    return teile.join('\r\n');
  }

  function icsDatei(poll) {
    var fest = null;
    poll.optionen.forEach(function (o) { if (o.id === poll.entschieden_option) fest = o; });
    if (!fest) return null;

    var ganztag = fest.beginnt_am.length <= 10;
    var start, ende;

    if (ganztag) {
      start = 'DTSTART;VALUE=DATE:' + fest.beginnt_am.replace(/-/g, '');
      var naechster = new Date(fest.beginnt_am + 'T00:00');
      naechster.setDate(naechster.getDate() + 1);
      ende = 'DTEND;VALUE=DATE:' + naechster.toISOString().slice(0, 10).replace(/-/g, '');
    } else {
      var d = new Date(fest.beginnt_am);
      var roh = function (x) {
        return x.getFullYear() + zwei(x.getMonth() + 1) + zwei(x.getDate()) + 'T' +
               zwei(x.getHours()) + zwei(x.getMinutes()) + '00';
      };
      var bis = new Date(d.getTime() + ABEND_STUNDEN * 3600 * 1000);
      start = 'DTSTART:' + roh(d);
      ende  = 'DTEND:'   + roh(bis);
    }

    var l = lage(poll, fest.id);
    var beschreibung = poll.titel +
      (l.namenJa.length ? '\nDabei: ' + l.namenJa.join(', ') : '') +
      (l.leiter.length ? '\n' + l.leiter[0].name + ' leitet.' : '') +
      '\n' + seitenLink(poll.id);

    /* Zeilenenden müssen CRLF sein, sonst mäkeln manche Kalender */
    return [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BotC Regelwiki//DE',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      'UID:' + poll.id + '@botc-regelwiki',
      'DTSTAMP:' + icsStempel(),
      start,
      ende,
      'SUMMARY:' + icsEscape('Blood on the Clocktower'),
      'DESCRIPTION:' + icsEscape(beschreibung),
      fest.label ? 'LOCATION:' + icsEscape(fest.label) : null,
      'END:VEVENT',
      'END:VCALENDAR'
    ].filter(Boolean).map(icsFalte).join('\r\n') + '\r\n';
  }

  function ladeIcsHerunter(poll) {
    var text = icsDatei(poll);
    if (!text) return;
    var fest = null;
    poll.optionen.forEach(function (o) { if (o.id === poll.entschieden_option) fest = o; });

    var blob = new Blob([text], { type: 'text/calendar;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'botc-' + fest.beginnt_am.slice(0, 10) + '.ics';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
      /* Spart das Abtippen von zehn Freitagen und Samstagen */
      '<div class="schnell">' +
        '<span class="field__label">Ganzen Monat eintragen</span>' +
        '<div class="schnell__reihe">' +
          '<select data-feld="monat" aria-label="Monat">' +
            MONATE.map(function (m, i) {
              return '<option value="' + i + '"' + (i === e.monat ? ' selected' : '') + '>' +
                     esc(m) + '</option>';
            }).join('') +
          '</select>' +
          '<select data-feld="jahr" aria-label="Jahr">' +
            [0, 1].map(function (v) {
              var j = new Date().getFullYear() + v;
              return '<option value="' + j + '"' + (j === e.jahr ? ' selected' : '') + '>' +
                     j + '</option>';
            }).join('') +
          '</select>' +
          '<input type="time" data-feld="schnellzeit" value="' + esc(e.schnellzeit) + '" aria-label="Uhrzeit">' +
        '</div>' +
        '<div class="chipset wochentage">' +
          WOCHENTAGE.map(function (t) {
            var an = e.tage.indexOf(t.n) !== -1;
            return '<button type="button" class="chip' + (an ? ' is-active' : '') +
                   '" data-tag="' + t.n + '" aria-pressed="' + an + '">' + t.k + '</button>';
          }).join('') +
        '</div>' +
        '<button type="button" class="btn btn--small" data-act="monat-fuellen">Termine eintragen</button>' +
      '</div>' +

      '<span class="field__label">Terminvorschläge</span>' +
      '<div class="tvorschlaege">' + zeilen + '</div>' +
      (e.optionen.length < MAX_OPTIONEN
        ? '<button type="button" class="btn btn--ghost btn--small" data-act="mehr">+ Vorschlag</button>'
        : '<p class="notiz-klein">Mehr als ' + MAX_OPTIONEN + ' Vorschläge gehen nicht.</p>') +
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
        '<p class="mein-hinweis">Jeder Tipp wird sofort gespeichert — du musst nichts abschicken.</p>' +
      '</div>';

    var termine = p.optionen.map(function (o) {
      var l = lage(p, o.id);
      var meine = meineAntworten[o.id] || '';
      var istFest = p.entschieden_option === o.id;

      return '<div class="tblock' + (istFest ? ' tblock--fest' : '') +
             '" data-stufe="' + l.stufe + '">' +
        '<div class="tblock__kopf">' +
          '<strong class="tblock__datum">' + esc(fmtDatum(o.beginnt_am)) + '</strong>' +
          (o.label ? '<span class="tblock__ort">' + esc(o.label) + '</span>' : '') +
          (istFest ? '<span class="pill pill--fest">Festgelegt</span>' : '') +
        '</div>' +

        '<p class="tblock__lage">' + esc(l.text) +
          (l.verteilung ? '<span class="tblock__verteilung">' + esc(l.verteilung) + '</span>' : '') +
        '</p>' +

        (l.namenJa.length
          ? '<p class="tblock__namen"><strong>Dabei:</strong> ' + esc(l.namenJa.join(', ')) + '</p>' : '') +
        (l.namenVielleicht.length
          ? '<p class="tblock__namen tblock__namen--vielleicht"><strong>Vielleicht:</strong> ' +
            esc(l.namenVielleicht.join(', ')) + '</p>' : '') +

        '<div class="tblock__fuss">' +
          /* Bei abgesagten Abfragen gibt es nichts mehr zu antworten — die
             Knöpfe wären klickbar, ohne dass man speichern könnte. */
          (p.status === 'abgesagt'
            ? (meine ? '<span class="tblock__meine">Deine Antwort war: ' +
                       esc((ANTWORTEN.filter(function (a) { return a.id === meine; })[0] || {}).label || meine) +
                       '</span>' : '')
            : '<div class="seg antwortwahl">' +
              ANTWORTEN.map(function (a) {
                return '<button type="button" class="seg__btn' + (a.id === meine ? ' is-active' : '') +
                       '" data-antwort="' + a.id + '" data-option="' + esc(o.id) + '">' +
                       esc(a.label) + '</button>';
              }).join('') +
            '</div>') +
          (p.status === 'offen'
            ? '<button type="button" class="btn btn--ghost btn--small" data-act="festlegen" ' +
              'data-option="' + esc(o.id) + '">Diesen Termin festlegen</button>'
            : '') +
        '</div>' +
      '</div>';
    }).join('');

    zeichne(kopf + meins + '<div class="tbloecke">' + termine + '</div>' +
      '<div class="termine-aktionen">' +
        (p.status !== 'abgesagt'
          ? '<button type="button" class="btn btn--primary" data-act="speichern">Jetzt speichern</button>'
          : '') +
        '<button type="button" class="btn" data-act="whatsapp">Text für WhatsApp</button>' +
        (p.status === 'entschieden'
          ? '<button type="button" class="btn" data-act="ics">In den Kalender</button>'
          : '') +
        '<button type="button" class="btn btn--ghost btn--small" data-act="neuladen">Stand aktualisieren</button>' +
        (p.status !== 'abgesagt'
          ? '<button type="button" class="btn btn--ghost btn--small" data-act="absagen">' +
            (p.status === 'entschieden' ? 'Runde absagen' : 'Abfrage abbrechen') + '</button>'
          : '') +
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
    var jetzt = new Date();
    return {
      titel: '', von: lokal.name || '', frist: '',
      optionen: [{ datum: '', zeit: '18:00', label: '' }],
      /* Für die Schnellbefüllung: voreingestellt der laufende Monat,
         Freitag und Samstag um 18 Uhr. */
      monat: jetzt.getMonth(),
      jahr: jetzt.getFullYear(),
      schnellzeit: '18:00',
      tage: [5, 6]
    };
  }

  /* Alle passenden Tage eines Monats. Vergangene Tage fallen raus — einen
     Termin vorzuschlagen, der schon vorbei ist, hilft niemandem. */
  function monatsTermine(jahr, monat, tage, zeit) {
    var out = [];
    var heute = new Date();
    heute.setHours(0, 0, 0, 0);

    var d = new Date(jahr, monat, 1);
    while (d.getMonth() === monat) {
      if (tage.indexOf(d.getDay()) !== -1 && d >= heute) {
        out.push({
          datum: d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate()),
          zeit: zeit,
          label: ''
        });
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function monatFuellen() {
    var e = entwurf;
    if (!e.tage.length) {
      sicht.fehler = 'Mindestens einen Wochentag auswählen.';
      return zeichneAnlegen();
    }

    var neu = monatsTermine(e.jahr, e.monat, e.tage, e.schnellzeit);

    if (!neu.length) {
      sicht.fehler = 'In ' + MONATE[e.monat] + ' ' + e.jahr +
                     ' liegt kein solcher Tag mehr in der Zukunft.';
      return zeichneAnlegen();
    }

    /* Schon getippte Termine nicht stillschweigend wegwerfen */
    var befuellt = e.optionen.filter(function (o) { return o.datum; });
    if (befuellt.length && !confirm('Die ' + befuellt.length +
        ' bereits eingetragenen Termine werden ersetzt. Weiter?')) return;

    var gekappt = neu.length > MAX_OPTIONEN;
    e.optionen = neu.slice(0, MAX_OPTIONEN);
    e.titel = e.titel || 'Runde im ' + MONATE[e.monat];

    sicht.fehler = gekappt
      ? 'Es passen höchstens ' + MAX_OPTIONEN + ' Vorschläge — die späteren wurden weggelassen.'
      : '';
    zeichneAnlegen();
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
        ladeBanner();   /* jetzt erst darf das Banner überhaupt etwas anzeigen */
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
        else if (f === 'monat' || f === 'jahr') entwurf[f] = Number(ev.target.value);
        else if (f === 'schnellzeit') entwurf.schnellzeit = ev.target.value;
        else if (f === 'titel' || f === 'von' || f === 'frist') entwurf[f] = ev.target.value;
        return;
      }
      if (f === 'name') {
        lokal.name = ev.target.value;
        sichereLokal();
        /* Nicht bei jedem Buchstaben zum Server — aber wer den Namen
           nachträgt, soll seine schon getippten Antworten nicht verlieren. */
        clearTimeout(nameTimer);
        nameTimer = setTimeout(function () {
          if (sicht.modus === 'detail' && ev.target.value.trim()) speichern({ leise: true });
        }, 900);
      }
    });

    r.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act], [data-poll], [data-rolle], [data-antwort], [data-tag]');
      if (!btn) return;

      /* Wochentag für die Schnellbefüllung an- oder abschalten */
      if (btn.dataset.tag != null && entwurf) {
        var t = Number(btn.dataset.tag);
        var i = entwurf.tage.indexOf(t);
        if (i === -1) entwurf.tage.push(t); else entwurf.tage.splice(i, 1);
        btn.classList.toggle('is-active');
        btn.setAttribute('aria-pressed', String(entwurf.tage.indexOf(t) !== -1));
        return;
      }

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
        speichern({ leise: true });
        return;
      }

      if (btn.dataset.antwort) {
        btn.parentNode.querySelectorAll('.seg__btn').forEach(function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        speichern({ leise: true });
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

        case 'monat-fuellen':
          monatFuellen();
          break;

        case 'mehr':
          if (entwurf.optionen.length < MAX_OPTIONEN) {
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

        case 'whatsapp':
          if (sicht.poll) zeigeTextZumKopieren(whatsappText(sicht.poll));
          break;

        case 'ics':
          if (sicht.poll) ladeIcsHerunter(sicht.poll);
          break;

        case 'festlegen':
          festlegen(btn.dataset.option);
          break;

        case 'absagen':
          absagen();
          break;
      }
    });

    /* Banner: liegt außerhalb von #termine-root */
    var b = bannerEl();
    if (b) {
      b.addEventListener('click', function (ev) {
        var z = ev.target.closest('[data-banner]');
        if (z) BOTC.gotoTab('termine', z.dataset.banner);
      });
    }

    /* Overlay für den WhatsApp-Text */
    document.addEventListener('click', function (ev) {
      var o = ev.target.closest('#wa-overlay');
      if (!o) return;
      if (ev.target.closest('[data-wa-close]') || ev.target.classList.contains('sheetover')) {
        o.remove();
        document.body.classList.remove('is-locked');
        return;
      }
      if (ev.target.closest('[data-wa-kopieren]')) {
        kopiereInZwischenablage(document.getElementById('wa-text').value);
      }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var o = document.getElementById('wa-overlay');
      if (o) { o.remove(); document.body.classList.remove('is-locked'); }
    });

    ladeBanner();

    /* Wer die Abfrage offen liegen lässt, sieht sonst einen Stand von vor
       einer Stunde. Beim Zurückkommen einmal nachladen — bewusst kein
       Dauerabruf im Sekundentakt, D1 liefert bei Überschreiten der
       Gratis-Grenzen seit September 2026 Fehler statt Verlangsamung. */
    function nachladenWennSichtbar() {
      if (document.hidden || !lokal.gruppenwort) return;

      /* Das Banner hängt an keinem Tab und wird immer aufgefrischt */
      ladeBanner();

      var panel = document.getElementById('panel-termine');
      if (!panel || panel.hidden) return;

      /* Wer gerade tippt, soll nicht mitten im Wort neu gezeichnet bekommen */
      var aktiv = document.activeElement;
      if (aktiv && panel.contains(aktiv) &&
          (aktiv.tagName === 'INPUT' || aktiv.tagName === 'TEXTAREA')) return;

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
      ladeBanner();
    }).catch(function (err) {
      sicht.fehler = err.message;
      zeichneAnlegen();
    });
  }

  /* Festlegen darf jeder, nicht nur wer die Abfrage gestartet hat — sonst
     steht die Runde still, wenn ausgerechnet der krank wird. Dafür eine
     Rückfrage mit der Lage im Klartext, damit niemand versehentlich einen
     Termin festnagelt, an dem es hinten und vorne nicht reicht. */
  function festlegen(optionId) {
    var p = sicht.poll;
    if (!p || !optionId) return;

    var o = null;
    p.optionen.forEach(function (x) { if (x.id === optionId) o = x; });
    if (!o) return;

    var l = lage(p, optionId);
    var frage = 'Termin festlegen auf ' + fmtDatum(o.beginnt_am) +
                (o.label ? ' (' + o.label + ')' : '') + '?\n\n' + l.text;
    if (l.stufe !== 'gruen') frage += '\n\nAchtung: So reicht es noch nicht.';

    if (!confirm(frage)) return;

    var status = document.getElementById('termine-status');
    if (status) status.textContent = 'Wird festgelegt …';

    req('/api/polls/' + encodeURIComponent(p.id) + '/decide', { body: { option_id: optionId } })
      .then(function (neu) {
        sicht.poll = neu;
        zeichneDetail();
        ladeBanner();
      })
      .catch(function (e) {
        var s = document.getElementById('termine-status');
        if (s) s.textContent = e.message;
      });
  }

  function absagen() {
    var p = sicht.poll;
    if (!p) return;

    var was = p.status === 'entschieden' ? 'Die Runde wirklich absagen?'
                                         : 'Die Abfrage wirklich abbrechen?';
    if (!confirm(was + '\n\nDas lässt sich nicht rückgängig machen.')) return;

    var grund = prompt('Kurz der Grund? (steht dann im WhatsApp-Text)', '') || '';

    var status = document.getElementById('termine-status');
    if (status) status.textContent = 'Wird abgesagt …';

    req('/api/polls/' + encodeURIComponent(p.id) + '/cancel', { body: { grund: grund } })
      .then(function (neu) {
        sicht.poll = neu;
        zeichneDetail();
        ladeBanner();
      })
      .catch(function (e) {
        var s = document.getElementById('termine-status');
        if (s) s.textContent = e.message;
      });
  }

  /* Jeder Tipp auf eine Antwort speichert sofort. Vorher zaehlte nur, was
     man anschliessend ueber "Antwort speichern" abgeschickt hatte — wer
     zwischendurch die Seite verliess, fand seine Auswahl beim Zurueckkommen
     wieder leer vor, weil dann der Serverstand neu gezeichnet wird.

     leise = ohne Neuzeichnen der Liste. Beim Tippen soll nichts springen;
     die Auswahl steht ja schon richtig da. */
  function speichern(opt) {
    opt = opt || {};
    var p = sicht.poll;
    if (!p || p.status === 'abgesagt') return;

    var nameFeld = wurzel().querySelector('[data-feld="name"]');
    var name = nameFeld ? nameFeld.value.trim() : '';
    var status = document.getElementById('termine-status');
    var melde = function (s) { if (status) status.textContent = s; };

    if (!name) {
      melde('Bitte trag deinen Namen ein — dann wird deine Antwort gespeichert.');
      if (!opt.leise && nameFeld) nameFeld.focus();
      return;
    }

    var rolleBtn = wurzel().querySelector('.rollen .chip.is-active');
    var rolle = rolleBtn ? rolleBtn.dataset.rolle : 'spieler';

    var antworten = {};
    wurzel().querySelectorAll('.antwortwahl .seg__btn.is-active').forEach(function (b) {
      antworten[b.dataset.option] = b.dataset.antwort;
    });

    melde('Wird gespeichert …');

    req('/api/polls/' + encodeURIComponent(p.id) + '/vote', { body: {
      voter_id: lokal.voterId, name: name, rolle: rolle, antworten: antworten
    }}).then(function (neu) {
      lokal.name = name;
      sichereLokal();
      sicht.poll = neu;

      if (opt.leise) {
        /* Nur die Lagemeldungen auffrischen, Eingabefeld und Auswahl bleiben
           stehen — sonst verliert man beim Tippen den Cursor. */
        aktualisiereLagen();
      } else {
        zeichneDetail();
      }
      ladeBanner();

      var s = document.getElementById('termine-status');
      if (s) {
        s.textContent = 'Gespeichert.';
        setTimeout(function () { if (s.textContent === 'Gespeichert.') s.textContent = ''; }, 2500);
      }
    }).catch(function (err) {
      var s = document.getElementById('termine-status');
      if (s) s.textContent = err.message;
    });
  }

  /* Ampel, Namen und Verteilung je Termin neu schreiben, ohne die Knoepfe
     anzufassen. */
  function aktualisiereLagen() {
    var p = sicht.poll;
    if (!p) return;

    wurzel().querySelectorAll('.tblock').forEach(function (block, i) {
      var o = p.optionen[i];
      if (!o) return;
      var l = lage(p, o.id);

      block.dataset.stufe = l.stufe;

      var lageEl = block.querySelector('.tblock__lage');
      if (lageEl) {
        lageEl.innerHTML = esc(l.text) +
          (l.verteilung ? '<span class="tblock__verteilung">' + esc(l.verteilung) + '</span>' : '');
      }

      block.querySelectorAll('.tblock__namen').forEach(function (n) { n.remove(); });
      var davor = block.querySelector('.tblock__fuss');
      var einfuegen = function (html) {
        if (davor) davor.insertAdjacentHTML('beforebegin', html);
      };
      if (l.namenJa.length) {
        einfuegen('<p class="tblock__namen"><strong>Dabei:</strong> ' +
                  esc(l.namenJa.join(', ')) + '</p>');
      }
      if (l.namenVielleicht.length) {
        einfuegen('<p class="tblock__namen tblock__namen--vielleicht"><strong>Vielleicht:</strong> ' +
                  esc(l.namenVielleicht.join(', ')) + '</p>');
      }
    });
  }

  BOTC.termine = { init: init, show: zeige, lage: lage, fmtDatum: fmtDatum };

})(window.BOTC);
