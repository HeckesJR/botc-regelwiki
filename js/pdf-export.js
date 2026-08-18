/* ============================================================
   pdf-export.js — Setup als PDF im Pergament-Design (jsPDF, clientseitig)
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  /* Farben passend zum Tool (RGB) */
  var C = {
    parchment: [239, 228, 204],
    parchmentDeep: [222, 206, 172],
    bordeaux: [92, 31, 46],
    gold: [168, 137, 76],
    ink: [43, 33, 23],
    inkSoft: [91, 74, 52],
    good: [39, 74, 120],
    evil: [124, 28, 34]
  };

  var PAGE = { w: 210, h: 297 };          /* A4 hochkant, mm */
  var MARGIN = 18;
  var CONTENT_W = PAGE.w - MARGIN * 2;

  function getJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return window.jspdf.jsPDF;
    if (window.jsPDF) return window.jsPDF;
    return null;
  }

  function available() { return !!getJsPDF(); }

  /* ---------------------------------------------- Icons für das PDF
     jsPDF kann kein WebP. Die Icons werden deshalb über ein Canvas in
     PNG umgewandelt — mit weißem Grund, weil PNG-Transparenz im PDF
     sonst schwarz aufliegt. Fällt das WebP aus, greift das SVG-Emblem. */

  var iconCache = {};

  function loadIcon(url) {
    if (iconCache[url]) return Promise.resolve(iconCache[url]);

    return new Promise(function (resolve) {
      var img = new Image();
      var done = false;

      function finish(value) {
        if (done) return;
        done = true;
        iconCache[url] = value;
        resolve(value);
      }

      img.onload = function () {
        try {
          /* 96 px reichen für 9 mm Kantenlänge im Druck (≈270 dpi).
             JPEG statt PNG — das drückt ein 25-Charakter-Blatt von rund
             1,7 MB auf etwa 80 kB. Als Grund die Pergamentfarbe statt
             Weiß, damit die Icons nicht als Kästchen auf dem Blatt sitzen. */
          var size = 96;
          var c = document.createElement('canvas');
          c.width = size; c.height = size;
          var ctx = c.getContext('2d');
          ctx.fillStyle = 'rgb(239,228,204)';
          ctx.fillRect(0, 0, size, size);
          var s = Math.min(size / img.width, size / img.height);
          var w = img.width * s, h = img.height * s;
          ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
          finish(c.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          finish(null);
        }
      };
      img.onerror = function () {
        /* WebP fehlt? Dann das SVG-Emblem versuchen — aber nur einmal. */
        if (/\.webp$/.test(url)) {
          loadIcon(url.replace(/\.webp$/, '.svg')).then(finish);
        } else {
          finish(null);
        }
      };
      img.src = url;
    });
  }

  function loadIcons(characters) {
    return Promise.all(characters.map(function (ch) {
      return loadIcon(ch.icon).then(function (data) { return { id: ch.id, data: data }; });
    })).then(function (list) {
      var map = {};
      list.forEach(function (e) { map[e.id] = e.data; });
      return map;
    });
  }

  /* ---------------------------------------------- Titel in der Display-Schrift

     jsPDF kennt nur seine eingebauten Schriften. Eine TTF einzubetten würde
     die Datei um gut 150 kB aufblähen und die Schrift mitverteilen. Da die
     Seite Grenze Gotisch ohnehin geladen hat, wird der Titel stattdessen
     im Browser auf ein Canvas gezeichnet und als Bild eingesetzt — exakt
     dieselbe Schrift, nur ein paar Kilobyte groß. */

  var DISPLAY_FONT = '"Grenze Gotisch", "Palatino Linotype", Georgia, serif';

  function renderTitleImage(str, rgb) {
    var text = String(str || '');
    if (!text) return Promise.resolve(null);

    var ready = (document.fonts && document.fonts.load)
      ? document.fonts.load('700 120px "Grenze Gotisch"').catch(function () {})
      : Promise.resolve();

    return ready.then(function () {
      try {
        var fontPx = 160;                 /* groß rendern, im PDF verkleinert = scharf */
        var pad = 16;
        var probe = document.createElement('canvas').getContext('2d');
        probe.font = '700 ' + fontPx + 'px ' + DISPLAY_FONT;
        var m = probe.measureText(text);

        var asc = m.actualBoundingBoxAscent || fontPx * 0.80;
        var desc = m.actualBoundingBoxDescent || fontPx * 0.24;
        var w = Math.ceil(m.width) + pad * 2;
        var h = Math.ceil(asc + desc) + pad * 2;
        if (!w || !h || w > 6000) return null;

        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        var ctx = c.getContext('2d');
        /* Pergamentgrund, damit das Bild nahtlos auf der Seite sitzt */
        ctx.fillStyle = 'rgb(239,228,204)';
        ctx.fillRect(0, 0, w, h);
        ctx.font = '700 ' + fontPx + 'px ' + DISPLAY_FONT;   /* nach Resize neu setzen */
        ctx.fillStyle = 'rgb(' + rgb.join(',') + ')';
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(text, pad, asc + pad);

        return { data: c.toDataURL('image/jpeg', 0.92), w: w, h: h };
      } catch (e) {
        return null;
      }
    });
  }

  /* ---------------------------------------------- Seitendekoration */

  function paintPage(doc) {
    /* Pergament-Grund */
    doc.setFillColor.apply(doc, C.parchment);
    doc.rect(0, 0, PAGE.w, PAGE.h, 'F');

    /* dezente Randabdunklung: konzentrische Rahmen mit geringer Deckkraft */
    doc.setDrawColor.apply(doc, C.parchmentDeep);
    for (var i = 0; i < 7; i++) {
      doc.setLineWidth(1.6);
      doc.rect(i * 1.5, i * 1.5, PAGE.w - i * 3, PAGE.h - i * 3);
    }

    /* Doppelrahmen im Regelwerk-Stil */
    doc.setDrawColor.apply(doc, C.bordeaux);
    doc.setLineWidth(0.9);
    doc.rect(MARGIN - 6, MARGIN - 6, CONTENT_W + 12, PAGE.h - (MARGIN - 6) * 2);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN - 4, MARGIN - 4, CONTENT_W + 8, PAGE.h - (MARGIN - 4) * 2);

    /* Eckrauten */
    var inset = MARGIN - 6;
    [[inset, inset], [PAGE.w - inset, inset],
     [inset, PAGE.h - inset], [PAGE.w - inset, PAGE.h - inset]].forEach(function (p) {
      diamond(doc, p[0], p[1], 2.2, C.bordeaux);
    });
  }

  function diamond(doc, x, y, r, color) {
    doc.setFillColor.apply(doc, color);
    doc.triangle(x, y - r, x + r, y, x, y + r, 'F');
    doc.triangle(x, y - r, x - r, y, x, y + r, 'F');
  }

  /* Ornamentale Trennlinie mit Raute in der Mitte */
  function fleuron(doc, y) {
    var mid = PAGE.w / 2;
    doc.setDrawColor.apply(doc, C.gold);
    doc.setLineWidth(0.4);
    doc.line(MARGIN + 6, y, mid - 7, y);
    doc.line(mid + 7, y, PAGE.w - MARGIN - 6, y);
    diamond(doc, mid, y, 2.4, C.bordeaux);
    doc.setFillColor.apply(doc, C.gold);
    doc.circle(mid - 11, y, 0.7, 'F');
    doc.circle(mid + 11, y, 0.7, 'F');
  }

  /* Die eingebauten jsPDF-Schriften können nur WinAnsi darstellen. Umlaute und
     ß sind darin enthalten, einige typografische Sonderzeichen aber nicht —
     die werden hier auf sichere Entsprechungen abgebildet. */
  var PDF_REPLACEMENTS = [
    [/−/g, '-'],   /* echtes Minuszeichen */
    [/‑/g, '-'],   /* geschützter Bindestrich */
    [/[‐‒]/g, '-'],
    [/ /g, ' '],   /* geschütztes Leerzeichen */
    [/ /g, ' '],
    [/[′‵]/g, "'"],
    [/◆/g, '*']    /* Raute aus der Web-Oberfläche */
  ];

  function pdfSafe(str) {
    var s = String(str == null ? '' : str);
    PDF_REPLACEMENTS.forEach(function (pair) { s = s.replace(pair[0], pair[1]); });
    return s;
  }

  /* ---------------------------------------------- Textfluss */

  function makeCursor(doc) {
    var state = { y: MARGIN + 6, page: 1 };

    function ensure(needed) {
      if (state.y + needed <= PAGE.h - MARGIN - 6) return;
      doc.addPage();
      state.page++;
      paintPage(doc);
      state.y = MARGIN + 6;
    }

    return {
      get y() { return state.y; },
      set y(v) { state.y = v; },
      get page() { return state.page; },
      ensure: ensure
    };
  }

  function text(doc, cur, str, opts) {
    opts = opts || {};
    var size = opts.size || 10;
    var style = opts.style || 'normal';
    var font = opts.font || 'times';
    var color = opts.color || C.ink;
    var lineH = opts.lineHeight || size * 0.42 + 1.2;
    var indent = opts.indent || 0;
    var width = CONTENT_W - indent;

    doc.setFont(font, style);
    doc.setFontSize(size);
    doc.setTextColor.apply(doc, color);

    var lines = doc.splitTextToSize(pdfSafe(str), width);
    lines.forEach(function (line) {
      cur.ensure(lineH);
      var x = MARGIN + indent;
      if (opts.align === 'center') {
        doc.text(line, PAGE.w / 2, cur.y, { align: 'center' });
      } else {
        doc.text(line, x, cur.y);
      }
      cur.y += lineH;
    });
    if (opts.spaceAfter) cur.y += opts.spaceAfter;
  }

  /* ---------------------------------------------- Hauptexport */

  /**
   * @param {Object} suggestion  ein Eintrag aus BOTC.suggestSetups().suggestions
   * @param {Object} meta        { editionName, players, travellers }
   */
  function exportSetup(suggestion, meta) {
    var JsPDF = getJsPDF();
    if (!JsPDF) {
      alert('Die PDF-Bibliothek konnte nicht geladen werden. Prüfe, ob vendor/jspdf.umd.min.js vorhanden ist.');
      return;
    }

    var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    paintPage(doc);
    var cur = makeCursor(doc);

    /* --- Kopf --- */
    cur.y += 4;
    text(doc, cur, 'Blood on the Clocktower', {
      size: 9, font: 'times', style: 'italic', color: C.inkSoft, align: 'center', lineHeight: 5
    });
    text(doc, cur, suggestion.name.toUpperCase(), {
      size: 24, font: 'times', style: 'bold', color: C.bordeaux, align: 'center', lineHeight: 11
    });
    cur.y += 1;
    fleuron(doc, cur.y);
    cur.y += 8;

    /* --- Eckdaten --- */
    var facts = [
      meta.editionName,
      meta.players + ' Spieler',
      suggestion.difficulty ? 'Schwierigkeit: ' + suggestion.difficulty : null,
      suggestion.curated ? 'Setup aus dem Regelwerk' : 'Setup zusammengestellt'
    ].filter(Boolean).join('   ·   ');

    text(doc, cur, facts, {
      size: 10, style: 'bold', color: C.inkSoft, align: 'center', lineHeight: 5, spaceAfter: 5
    });

    /* --- Verteilung als Kästchenreihe --- */
    var d = suggestion.distribution;
    var cells = [
      { label: 'Bürger', value: d.townsfolk, color: C.good },
      { label: 'Außenseiter', value: d.outsider, color: C.good },
      { label: 'Schergen', value: d.minion, color: C.evil },
      { label: 'Dämon', value: d.demon, color: C.evil }
    ];
    if (meta.travellers > 0) {
      cells.push({ label: 'Reisende', value: meta.travellers, color: C.gold });
    }

    var cw = CONTENT_W / cells.length;
    var boxH = 16;
    cur.ensure(boxH + 6);
    cells.forEach(function (cell, i) {
      var x = MARGIN + i * cw;
      doc.setDrawColor.apply(doc, C.parchmentDeep);
      doc.setLineWidth(0.3);
      doc.rect(x + 1, cur.y, cw - 2, boxH);
      doc.setDrawColor.apply(doc, cell.color);
      doc.setLineWidth(1);
      doc.line(x + 1, cur.y, x + cw - 1, cur.y);

      doc.setFont('times', 'bold');
      doc.setFontSize(17);
      doc.setTextColor.apply(doc, cell.color);
      doc.text(String(cell.value), x + cw / 2, cur.y + 8, { align: 'center' });

      doc.setFont('times', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor.apply(doc, C.inkSoft);
      doc.text(pdfSafe(cell.label), x + cw / 2, cur.y + 13, { align: 'center' });
    });
    cur.y += boxH + 8;

    /* --- Begründung --- */
    text(doc, cur, 'WARUM DIESES SETUP', {
      size: 9, style: 'bold', color: C.bordeaux, lineHeight: 5
    });
    doc.setDrawColor.apply(doc, C.parchmentDeep);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, cur.y - 3, PAGE.w - MARGIN, cur.y - 3);
    cur.y += 1;
    text(doc, cur, suggestion.reason, {
      size: 10.5, style: 'italic', color: C.ink, lineHeight: 5, spaceAfter: 6
    });

    /* --- Charakterliste nach Typ --- */
    var groups = [
      { type: 'townsfolk', label: 'Bürger', color: C.good },
      { type: 'outsider',  label: 'Außenseiter', color: C.good },
      { type: 'minion',    label: 'Schergen', color: C.evil },
      { type: 'demon',     label: 'Dämon', color: C.evil }
    ];

    groups.forEach(function (g) {
      var members = suggestion.characters.filter(function (ch) { return ch.type === g.type; });
      if (!members.length) return;

      cur.ensure(14);
      text(doc, cur, g.label.toUpperCase(), {
        size: 9, style: 'bold', color: g.color, lineHeight: 5
      });
      doc.setDrawColor.apply(doc, g.color);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, cur.y - 3, PAGE.w - MARGIN, cur.y - 3);
      cur.y += 1.5;

      members.forEach(function (ch) {
        cur.ensure(9);
        doc.setFillColor.apply(doc, g.color);
        doc.circle(MARGIN + 1.4, cur.y - 1.3, 0.9, 'F');

        doc.setFont('times', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor.apply(doc, C.ink);
        doc.text(pdfSafe(ch.name_de), MARGIN + 5, cur.y);

        var nameW = doc.getTextWidth(pdfSafe(ch.name_de));
        doc.setFont('times', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor.apply(doc, C.inkSoft);
        doc.text('(' + pdfSafe(ch.name_en) + ')', MARGIN + 7 + nameW, cur.y);
        cur.y += 4.4;

        text(doc, cur, ch.ability_short, {
          size: 9, color: C.inkSoft, indent: 5, lineHeight: 4
        });
        cur.y += 1.6;
      });
      cur.y += 3;
    });

    /* --- Bluffs für den Dämon --- */
    if (suggestion.bluffs && suggestion.bluffs.length) {
      cur.ensure(20);
      text(doc, cur, 'BLUFFS FÜR DEN DÄMON', {
        size: 9, style: 'bold', color: C.bordeaux, lineHeight: 5
      });
      doc.setDrawColor.apply(doc, C.bordeaux);
      doc.setLineWidth(0.3);
      doc.line(MARGIN, cur.y - 3, PAGE.w - MARGIN, cur.y - 3);
      cur.y += 1;

      text(doc, cur, 'Diese guten Charaktere sind nicht im Spiel — zeige sie dem Dämon in der ersten Nacht.', {
        size: 9, style: 'italic', color: C.inkSoft, lineHeight: 4, spaceAfter: 1
      });

      suggestion.bluffs.forEach(function (ch) {
        cur.ensure(6);
        doc.setFillColor.apply(doc, C.good);
        doc.circle(MARGIN + 1.4, cur.y - 1.3, 0.9, 'F');
        doc.setFont('times', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor.apply(doc, C.good);
        doc.text(pdfSafe(ch.name_de), MARGIN + 5, cur.y);
        var bw = doc.getTextWidth(pdfSafe(ch.name_de));
        doc.setFont('times', 'italic');
        doc.setFontSize(8.5);
        doc.setTextColor.apply(doc, C.inkSoft);
        doc.text('(' + pdfSafe(ch.name_en) + ')', MARGIN + 7 + bw, cur.y);
        cur.y += 5;
      });
      cur.y += 3;
    }

    /* --- Hinweise --- */
    var notes = [];
    if (suggestion.modifierNotes && suggestion.modifierNotes.length) {
      notes = notes.concat(suggestion.modifierNotes.map(function (n) {
        return 'Verteilung angepasst — ' + n;
      }));
    }
    if (suggestion.missing && suggestion.missing.length) {
      notes.push('Nicht vollständig auffüllbar: Es fehlen ' + suggestion.missing.join(', ') +
                 '. Diese Edition hat dafür zu wenige Charaktere.');
    }
    if (!suggestion.exact && suggestion.originalPlayers) {
      notes.push('Die Vorlage ist für ' + suggestion.originalPlayers + ' Spieler gedacht und wurde auf ' +
                 meta.players + ' Spieler erweitert.');
    }
    if (meta.travellers > 0) {
      notes.push('Ab 16 Spielern ist jeder weitere Spieler ein Reisender — hier ' + meta.travellers + '.');
    }

    if (notes.length) {
      cur.ensure(14);
      fleuron(doc, cur.y);
      cur.y += 7;
      text(doc, cur, 'HINWEISE', { size: 9, style: 'bold', color: C.bordeaux, lineHeight: 5 });
      notes.forEach(function (n) {
        text(doc, cur, '· ' + n, { size: 9, color: C.inkSoft, indent: 2, lineHeight: 4.2 });
      });
    }

    /* --- Fußzeile auf allen Seiten --- */
    var total = doc.getNumberOfPages();
    for (var p = 1; p <= total; p++) {
      doc.setPage(p);
      doc.setFont('times', 'italic');
      doc.setFontSize(7.5);
      doc.setTextColor.apply(doc, C.inkSoft);
      doc.text('Blood on the Clocktower — Regelwiki', MARGIN, PAGE.h - MARGIN + 1);
      doc.text(p + ' / ' + total, PAGE.w - MARGIN, PAGE.h - MARGIN + 1, { align: 'right' });
    }

    var slug = String(suggestion.name).toLowerCase()
      .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    doc.save('botc-setup-' + slug + '-' + meta.players + 'p.pdf');
  }

  /* ============================================================
     Skriptblatt — das Charakterblatt zum Ausdrucken für den Tisch,
     im Aufbau des offiziellen Handouts: Kopfzeile, zwei Spalten,
     Typ-Abschnitte mit senkrechtem Seitenlabel, Sternchen-Fußnote.
     ============================================================ */

  /* Der Inhalt muss innerhalb des Zierrahmens aus paintPage() bleiben.
     Der Rahmen läuft von MARGIN-6 bis PAGE.w-(MARGIN-6) — daraus wird
     hier alles abgeleitet, damit nichts über die Kante rutscht. */
  var FRAME_L = MARGIN - 6;
  var FRAME_R = PAGE.w - (MARGIN - 6);

  var SHEET = {
    pad: 3,            /* Abstand zwischen Rahmen und Inhalt */
    sidebar: 9,        /* Breite des Seitenstreifens links */
    colGap: 5,
    iconSize: 9,
    headerH: 30
  };

  var GROUPS = [
    { type: 'townsfolk', de: 'Bürger',      en: 'Townsfolk', color: 'good' },
    { type: 'outsider',  de: 'Außenseiter', en: 'Outsiders', color: 'good' },
    { type: 'minion',    de: 'Schergen',    en: 'Minions',   color: 'evil' },
    { type: 'demon',     de: 'Dämonen',     en: 'Demons',    color: 'evil' }
  ];

  /* Zeilenhöhe eines Eintrags bei gegebener Schriftgröße messen */
  function measureEntry(doc, ch, colW, fs) {
    var textW = colW - SHEET.iconSize - 3;
    doc.setFont('times', 'normal');
    doc.setFontSize(fs);
    var lines = doc.splitTextToSize(pdfSafe(ch.ability_short), textW);
    var nameH = fs * 0.44 + 1.4;
    var bodyH = lines.length * (fs * 0.38 + 0.7);
    return {
      lines: lines,
      height: Math.max(SHEET.iconSize + 1.5, nameH + bodyH) + 2.4
    };
  }

  /**
   * Verteilt so viele Einträge auf zwei Spalten, wie in maxH Höhe passen.
   * Passt alles, wird ausgewogen aufgeteilt (schöneres Bild). Passt es nicht,
   * werden die Spalten der Reihe nach gefüllt und der Rest zurückgegeben —
   * er landet dann auf der nächsten Seite.
   */
  function fitColumns(entries, maxH) {
    var total = entries.reduce(function (s, e) { return s + e.height; }, 0);

    if (total <= maxH * 2) {
      var cols = balance(entries);
      var used = Math.max(
        cols[0].reduce(function (s, e) { return s + e.height; }, 0),
        cols[1].reduce(function (s, e) { return s + e.height; }, 0)
      );
      return { cols: cols, used: used, rest: [] };
    }

    var c0 = [], c1 = [], h0 = 0, h1 = 0, i = 0;
    while (i < entries.length && h0 + entries[i].height <= maxH) {
      c0.push(entries[i]); h0 += entries[i].height; i++;
    }
    while (i < entries.length && h1 + entries[i].height <= maxH) {
      c1.push(entries[i]); h1 += entries[i].height; i++;
    }
    return { cols: [c0, c1], used: Math.max(h0, h1), rest: entries.slice(i) };
  }

  /* Einträge eines Abschnitts möglichst gleichmäßig auf zwei Spalten verteilen */
  function balance(entries) {
    var total = entries.reduce(function (s, e) { return s + e.height; }, 0);
    var half = total / 2, run = 0, cut = entries.length;
    for (var i = 0; i < entries.length; i++) {
      if (run + entries[i].height / 2 > half) { cut = i; break; }
      run += entries[i].height;
    }
    cut = Math.max(1, Math.min(cut, entries.length - 1));
    if (entries.length === 1) cut = 1;
    return [entries.slice(0, cut), entries.slice(cut)];
  }

  /* Gesamthöhe für eine Schriftgröße bestimmen (ohne zu zeichnen) */
  function layout(doc, groups, colW, fs) {
    var sections = [], total = 0;
    groups.forEach(function (g) {
      var entries = g.characters.map(function (ch) {
        var m = measureEntry(doc, ch, colW, fs);
        return { ch: ch, lines: m.lines, height: m.height };
      });
      var cols = balance(entries);
      var h = Math.max(
        cols[0].reduce(function (s, e) { return s + e.height; }, 0),
        cols[1].reduce(function (s, e) { return s + e.height; }, 0)
      );
      sections.push({ group: g, cols: cols, height: h });
      total += h + 5;   /* Trennlinie + Abstand */
    });
    return { sections: sections, total: total };
  }

  /**
   * @param {Array}  characters  Charaktere des Skripts
   * @param {Object} meta        { name, subtitle }
   */
  function exportScriptSheet(characters, meta) {
    var JsPDF = getJsPDF();
    if (!JsPDF) {
      alert('Die PDF-Bibliothek konnte nicht geladen werden.');
      return Promise.reject(new Error('jsPDF fehlt'));
    }
    meta = meta || {};

    var playable = characters.filter(function (ch) {
      return ['townsfolk', 'outsider', 'minion', 'demon'].indexOf(ch.type) !== -1;
    });
    if (!playable.length) return Promise.reject(new Error('Keine Charaktere'));

    return Promise.all([
      loadIcons(playable),
      renderTitleImage(meta.name || 'Skript', C.bordeaux)
    ]).then(function (res) {
      var icons = res[0];
      var titleImg = res[1];
      var doc = new JsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

      var sidebarX = FRAME_L + SHEET.pad;
      var contentX = sidebarX + SHEET.sidebar + 2;
      var contentR = FRAME_R - SHEET.pad;
      var contentW = contentR - contentX;
      var colW = (contentW - SHEET.colGap) / 2;
      var availH = PAGE.h - (MARGIN - 6) - SHEET.headerH - 14;

      var groups = GROUPS.map(function (g) {
        return {
          type: g.type, de: g.de, en: g.en,
          color: g.color === 'good' ? C.good : C.evil,
          characters: playable.filter(function (ch) { return ch.type === g.type; })
        };
      }).filter(function (g) { return g.characters.length; });

      /* Schriftgröße so wählen, dass alles auf eine Seite passt */
      var fs = 8, plan = layout(doc, groups, colW, fs);
      while (plan.total > availH && fs > 5.6) {
        fs -= 0.25;
        plan = layout(doc, groups, colW, fs);
      }

      var pageBottom = PAGE.h - (MARGIN - 6) - SHEET.pad - 6;

      /* Passt alles auf eine Seite, wird der übrige Platz gleichmäßig
         zwischen die Abschnitte verteilt — sonst läuft das Blatt unten leer. */
      var onePage = plan.total <= availH;
      var extra = onePage
        ? Math.min(9, Math.max(0, availH - plan.total) / Math.max(1, plan.sections.length))
        : 0;

      var page = 0, y = 0;

      function newPage(isFirst) {
        if (!isFirst) doc.addPage();
        page++;
        paintPage(doc);
        drawSheetHeader(doc, meta, playable.length, page, titleImg);
        doc.setFillColor(216, 199, 168);
        var stripTop = SHEET.headerH - 2;
        doc.rect(sidebarX, stripTop, SHEET.sidebar,
                 PAGE.h - stripTop - (MARGIN - 6) - SHEET.pad, 'F');
        y = SHEET.headerH + 2;
      }

      newPage(true);

      plan.sections.forEach(function (sec, si) {
        var rest = sec.cols[0].concat(sec.cols[1]);   /* wieder in Lesereihenfolge */

        while (rest.length) {
          /* Reicht der Platz noch für wenigstens einen Eintrag? */
          if (pageBottom - y < rest[0].height + 2) newPage(false);

          var chunk = fitColumns(rest, pageBottom - y);

          /* Sicherheitsnetz: passt nicht mal ein Eintrag, neue Seite */
          if (!chunk.cols[0].length && !chunk.cols[1].length) { newPage(false); continue; }

          [0, 1].forEach(function (ci) {
            var cx = contentX + ci * (colW + SHEET.colGap);
            var cy = y;
            chunk.cols[ci].forEach(function (e) {
              drawEntry(doc, e, icons, cx, cy, colW, fs, sec.group.color);
              cy += e.height;
            });
          });

          drawSidebarLabel(doc, sec.group, y, chunk.used, sidebarX);
          y += chunk.used + extra / 2;
          rest = chunk.rest;

          if (rest.length) newPage(false);
        }

        if (si < plan.sections.length - 1 && pageBottom - y > 6) {
          doc.setDrawColor.apply(doc, C.parchmentDeep);
          doc.setLineWidth(0.4);
          doc.line(contentX, y, contentR, y);
          y += 2.5 + extra / 2;
        }
      });

      drawStarNote(doc);

      /* Seitenzahlen nur, wenn es mehr als eine Seite geworden ist */
      if (doc.getNumberOfPages() > 1) {
        var total = doc.getNumberOfPages();
        for (var p = 1; p <= total; p++) {
          doc.setPage(p);
          doc.setFont('times', 'italic');
          doc.setFontSize(7.5);
          doc.setTextColor.apply(doc, C.inkSoft);
          doc.text(p + ' / ' + total, contentR, PAGE.h - MARGIN + 2, { align: 'right' });
        }
      }

      var slug = String(meta.name || 'skript').toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      doc.save('botc-skript-' + (slug || 'blatt') + '.pdf');
      return true;
    });
  }

  function drawSheetHeader(doc, meta, count, page, titleImg) {
    var midX = PAGE.w / 2;
    var name = pdfSafe(meta.name || 'Skript');
    var maxW = FRAME_R - FRAME_L - 20;
    var baseline = MARGIN + 2;

    if (titleImg) {
      /* Zielhöhe 12 mm, bei langen Namen über die Breite begrenzt */
      var h = 12;
      var w = h * (titleImg.w / titleImg.h);
      if (w > maxW) { w = maxW; h = w * (titleImg.h / titleImg.w); }
      try {
        doc.addImage(titleImg.data, 'JPEG', midX - w / 2, baseline - h + 2.5, w, h);
      } catch (e) {
        titleImg = null;
      }
    }

    if (!titleImg) {
      /* Rückfall auf die eingebaute Schrift, falls das Canvas nicht klappt */
      doc.setFont('times', 'bold');
      var size = 23;
      doc.setFontSize(size);
      while (doc.getTextWidth(name) > maxW && size > 12) {
        size -= 1;
        doc.setFontSize(size);
      }
      doc.setTextColor.apply(doc, C.bordeaux);
      doc.text(name, midX, baseline, { align: 'center' });
    }

    var sub = pdfSafe(meta.subtitle || (count + ' Charaktere'));
    if (page > 1) sub += ' · Fortsetzung';
    doc.setFont('times', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, C.inkSoft);
    doc.text(sub, midX, MARGIN + 8, { align: 'center' });

    fleuron(doc, MARGIN + 13);
  }

  /* Ein einziger gedrehter Text pro Abschnitt. Zwei getrennte Zeilen
     nebeneinander zu setzen ist bei gedrehtem Text fehleranfällig — sie
     überlagern sich je nach Abschnittshöhe. Deshalb beides in einer Zeile. */
  function drawSidebarLabel(doc, group, y, height, sidebarX) {
    var cx = sidebarX + SHEET.sidebar / 2;
    var label = group.de.toUpperCase() + '  ·  ' + group.en.toUpperCase();

    doc.setFont('times', 'bold');
    var size = 7;
    doc.setFontSize(size);
    /* Schrumpfen, falls der Abschnitt kürzer ist als die Beschriftung */
    while (doc.getTextWidth(label) > height - 4 && size > 4.5) {
      size -= 0.25;
      doc.setFontSize(size);
    }
    if (doc.getTextWidth(label) > height - 4) {
      label = group.de.toUpperCase();
      doc.setFontSize(7);
    }

    doc.setTextColor.apply(doc, group.color);
    doc.text(pdfSafe(label), cx + 1, y + height / 2, { align: 'center', angle: 90 });
  }

  function drawEntry(doc, entry, icons, x, y, colW, fs, color) {
    var ch = entry.ch;
    var img = icons[ch.id];
    var ty = y + fs * 0.36 + 1;

    if (img) {
      try { doc.addImage(img, 'JPEG', x, y, SHEET.iconSize, SHEET.iconSize); } catch (e) { /* egal */ }
    }

    var tx = x + SHEET.iconSize + 3;
    var tw = colW - SHEET.iconSize - 3;

    doc.setFont('times', 'bold');
    doc.setFontSize(fs + 0.6);
    doc.setTextColor.apply(doc, color);
    doc.text(pdfSafe(ch.name_de), tx, ty);

    var nameW = doc.getTextWidth(pdfSafe(ch.name_de));
    doc.setFont('times', 'italic');
    doc.setFontSize(fs - 0.6);
    doc.setTextColor.apply(doc, C.inkSoft);
    var en = '(' + pdfSafe(ch.name_en) + ')';
    if (nameW + doc.getTextWidth(en) + 1.5 < tw) {
      doc.text(en, tx + nameW + 1.5, ty);
    }

    ty += fs * 0.44 + 1;
    doc.setFont('times', 'normal');
    doc.setFontSize(fs);
    doc.setTextColor.apply(doc, C.ink);
    entry.lines.forEach(function (line) {
      doc.text(line, tx, ty);
      ty += fs * 0.38 + 0.7;
    });
  }

  function drawStarNote(doc) {
    var midX = PAGE.w / 2;
    var y = PAGE.h - MARGIN + 2;
    doc.setFillColor(232, 218, 189);
    doc.circle(midX, y - 1, 8, 'F');
    doc.setFont('times', 'italic');
    doc.setFontSize(7);
    doc.setTextColor.apply(doc, C.inkSoft);
    doc.text('* nicht in der', midX, y - 2.5, { align: 'center' });
    doc.text('ersten Nacht', midX, y + 0.5, { align: 'center' });
  }

  BOTC.pdf = {
    exportSetup: exportSetup,
    exportScriptSheet: exportScriptSheet,
    available: available
  };

})(window.BOTC);
