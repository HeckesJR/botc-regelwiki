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

  BOTC.pdf = { exportSetup: exportSetup, available: available };

})(window.BOTC);
