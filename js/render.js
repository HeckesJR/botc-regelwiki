/* ============================================================
   render.js — baut Regeln, Glossar, Charakterkarten und
   Nachtreihenfolge aus den JSON-Daten auf.
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  /* ---------------------------------------------- Hilfsfunktionen */

  var TYPE_LABEL = {
    townsfolk: 'Bürger',
    outsider:  'Außenseiter',
    minion:    'Schergen',
    demon:     'Dämon',
    traveller: 'Reisende',
    fabled:    'Fabled'
  };

  var TYPE_TONE = {
    townsfolk: 'good', outsider: 'good',
    minion: 'evil',    demon: 'evil',
    traveller: 'neutral', fabled: 'neutral'
  };

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* Minimales Inline-Markup: **fett** und *kursiv*. Erst escapen, dann ersetzen. */
  function inline(str) {
    return esc(str)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
  }

  /* Absätze aus \n\n, Aufzählungszeilen mit führendem • werden zur Liste */
  function richText(str) {
    if (!str) return '';
    var blocks = String(str).split(/\n\s*\n/);
    return blocks.map(function (block) {
      var lines = block.split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
      var bulletLines = lines.filter(function (l) { return l.charAt(0) === '•'; });

      if (bulletLines.length === lines.length && lines.length > 0) {
        return '<ul>' + lines.map(function (l) {
          return '<li>' + inline(l.replace(/^•\s*/, '')) + '</li>';
        }).join('') + '</ul>';
      }
      if (bulletLines.length > 0) {
        // gemischter Block: Fließtext, dann Liste
        var plain = lines.filter(function (l) { return l.charAt(0) !== '•'; });
        return '<p>' + inline(plain.join(' ')) + '</p><ul>' + bulletLines.map(function (l) {
          return '<li>' + inline(l.replace(/^•\s*/, '')) + '</li>';
        }).join('') + '</ul>';
      }
      return '<p>' + inline(lines.join(' ')) + '</p>';
    }).join('');
  }

  BOTC.esc = esc;
  BOTC.inline = inline;
  BOTC.richText = richText;
  BOTC.TYPE_LABEL = TYPE_LABEL;
  BOTC.TYPE_TONE = TYPE_TONE;

  /* ---------------------------------------------- Grundregeln */

  function renderRules(doc, root) {
    var html = '';

    if (doc.intro) {
      html += '<p class="rules__intro has-dropcap">' + inline(doc.intro) + '</p>';
    }

    doc.sections.forEach(function (section) {
      html += '<h2 id="' + esc(section.id) + '">' + esc(section.heading) + '</h2>';

      section.blocks.forEach(function (block) {
        switch (block.type) {
          case 'p':
            html += '<p>' + inline(block.text) + '</p>';
            break;

          case 'ul':
          case 'ol':
            html += '<' + block.type + '>' + block.items.map(function (item) {
              return '<li>' + inline(item) + '</li>';
            }).join('') + '</' + block.type + '>';
            break;

          case 'note':
            html += '<div class="note">' + inline(block.text) + '</div>';
            break;

          case 'dl':
            html += '<div class="deflist">' + block.items.map(function (item) {
              return '<div class="deflist__row" data-tone="' + esc(item.tone || 'neutral') + '">' +
                     '<div class="deflist__term">' + esc(item.term) + '</div>' +
                     '<p class="deflist__def">' + inline(item.def) + '</p>' +
                     '</div>';
            }).join('') + '</div>';
            break;

          case 'table':
            html += '<div class="table-wrap"><table><thead><tr>' +
                    block.head.map(function (h) { return '<th scope="col">' + esc(h) + '</th>'; }).join('') +
                    '</tr></thead><tbody>' +
                    block.rows.map(function (row, i) {
                      var tone = (block.rowTones && block.rowTones[i]) || 'neutral';
                      return '<tr data-tone="' + esc(tone) + '">' +
                             '<th scope="row">' + esc(row[0]) + '</th>' +
                             row.slice(1).map(function (cell) { return '<td>' + esc(cell) + '</td>'; }).join('') +
                             '</tr>';
                    }).join('') +
                    '</tbody></table></div>';
            break;
        }
      });
    });

    root.innerHTML = html;
  }

  /* ---------------------------------------------- Glossar */

  function renderGlossary(doc, root, filter) {
    var needle = (filter || '').trim().toLowerCase();

    var terms = doc.terms.filter(function (t) {
      if (!needle) return true;
      return (t.term + ' ' + (t.en || '') + ' ' + t.def).toLowerCase().indexOf(needle) !== -1;
    });

    if (!terms.length) {
      root.innerHTML = '<p class="empty-state">Kein Begriff gefunden.</p>';
      return;
    }

    var html = '';
    doc.categories.forEach(function (cat) {
      var inCat = terms.filter(function (t) { return t.category === cat.id; });
      if (!inCat.length) return;

      html += '<div class="glossary__group">' +
              '<h3 class="glossary__group-title">' + esc(cat.label) + '</h3>';

      inCat.forEach(function (t) {
        html += '<details' + (needle ? ' open' : '') + '>' +
                '<summary><span class="glossary__term">' + esc(t.term) + '</span>' +
                (t.en ? '<span class="glossary__en">' + esc(t.en) + '</span>' : '') +
                '</summary>' +
                '<div class="glossary__body"><p>' + inline(t.def) + '</p>' +
                (t.see_also && t.see_also.length
                  ? '<p class="glossary__see">Siehe auch: ' + t.see_also.map(esc).join(', ') + '</p>'
                  : '') +
                '</div></details>';
      });

      html += '</div>';
    });

    root.innerHTML = html;
  }

  /* ---------------------------------------------- Charakterkarten */

  function cardMarkup(ch) {
    var tone = TYPE_TONE[ch.type] || 'neutral';
    var parts = [];

    parts.push('<article class="card" data-type="' + esc(ch.type) + '" data-tone="' + tone +
               '" data-id="' + esc(ch.id) + '" tabindex="0" role="button" aria-expanded="false">');

    parts.push('<div class="card__head">');
    /* data-fallback: fehlt das offizielle WebP, springt app.js auf das SVG-Emblem zurück */
    parts.push('<img class="card__icon" src="' + esc(ch.icon) + '" alt="" aria-hidden="true" loading="lazy"' +
               ' data-fallback="' + esc(String(ch.icon).replace(/\.webp$/, '.svg')) + '">');
    parts.push('<div class="card__names"><h3 class="card__name">' + esc(ch.name_de) +
               '<span class="card__name-en">' + esc(ch.name_en) + '</span></h3></div>');
    parts.push('</div>');

    parts.push('<span class="card__type">' + esc(TYPE_LABEL[ch.type] || ch.type) + '</span>');
    parts.push('<p class="card__ability">' + inline(ch.ability_short) + '</p>');

    /* --- ausklappbarer Detailteil --- */
    parts.push('<div class="card__detail">');

    if (ch.quote) {
      parts.push('<blockquote class="card__quote">' + esc(ch.quote) + '</blockquote>');
    }

    if (ch.full_text) {
      parts.push('<section class="card__section"><h4 class="card__section-title">Wie die Fähigkeit wirkt</h4>' +
                 richText(ch.full_text) + '</section>');
    }

    if (ch.examples && ch.examples.length) {
      parts.push('<section class="card__section"><h4 class="card__section-title">Beispiele</h4><ul>' +
                 ch.examples.map(function (e) { return '<li>' + inline(e) + '</li>'; }).join('') +
                 '</ul></section>');
    }

    if (ch.how_to_run) {
      parts.push('<section class="card__section"><h4 class="card__section-title">So leitest du ihn/sie</h4>' +
                 richText(ch.how_to_run) + '</section>');
    }

    if (ch.tips && ch.tips.length) {
      parts.push('<section class="card__section"><h4 class="card__section-title">Tipps</h4><ul>' +
                 ch.tips.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') +
                 '</ul></section>');
    }

    /* Nacht-Badges */
    var badges = [];
    if (ch.wakes_first_night) {
      badges.push('<span class="badge badge--accent">Erste Nacht' +
                  (ch.night_order_first ? ' · Nr. ' + ch.night_order_first : '') + '</span>');
    }
    if (ch.wakes_other_nights) {
      badges.push('<span class="badge badge--accent">Andere Nächte' +
                  (ch.night_order_other ? ' · Nr. ' + ch.night_order_other : '') + '</span>');
    }
    if (!ch.wakes_first_night && !ch.wakes_other_nights) {
      badges.push('<span class="badge">Wacht nie auf</span>');
    }
    if (ch.setup_modifier) {
      var mod = ch.setup_modifier;
      var label;
      if (mod.outsider_choice) {
        label = 'Setup: ' + mod.outsider_choice.map(function (n) {
          return (n > 0 ? '+' : '−') + Math.abs(n);
        }).join(' oder ') + ' Außenseiter';
      } else {
        label = 'Setup: ' + (mod.outsider > 0 ? '+' : '−') + Math.abs(mod.outsider) + ' Außenseiter';
      }
      badges.push('<span class="badge badge--accent">' + esc(label) + '</span>');
    }
    parts.push('<div class="card__meta">' + badges.join('') + '</div>');

    if (ch.source_note) {
      parts.push('<p class="source-note">Hinweis zur Quelle: ' + esc(ch.source_note) + '</p>');
    }

    parts.push('</div>'); /* /card__detail */

    parts.push('<p class="card__hint">Klicken für Details</p>');
    parts.push('</article>');

    return parts.join('');
  }

  function renderCards(list, grid) {
    grid.innerHTML = list.map(cardMarkup).join('');
  }

  /* ---------------------------------------------- Nachtreihenfolge */

  /* Ein Charakter als Nachtschritt. Die Nummer wird getrennt übergeben, weil
     eigene Skripte durchnummeriert werden und nicht die Nummer der
     Herkunftsedition tragen dürfen. */
  function nightEntryFromCharacter(ch, order) {
    return {
      order: order,
      name: ch.name_de,
      en: ch.name_en,
      text: ch.ability_short,
      tone: TYPE_TONE[ch.type] || 'neutral',
      meta: false
    };
  }

  function nightEntryFromMeta(m, order) {
    return {
      order: order == null ? m.order : order,
      name: m.label,
      en: '',
      text: m.text,
      tone: 'neutral',
      meta: true
    };
  }

  /* Gemeinsame Ausgabe für Editionen und eigene Skripte. Erwartet eine
     bereits sortierte Liste. */
  function renderNightSteps(entries, list, emptyText) {
    if (!entries.length) {
      list.innerHTML = '<p class="empty-state">' +
        esc(emptyText || 'Hier sind keine Nachtschritte hinterlegt.') + '</p>';
      return;
    }

    list.innerHTML = entries.map(function (e) {
      return '<li class="night-item' + (e.meta ? ' night-item--meta' : '') + '" data-tone="' + e.tone + '">' +
             '<span class="night-item__num" aria-hidden="true">' + e.order + '</span>' +
             '<h3 class="night-item__name">' + esc(e.name) +
             (e.en ? ' <span class="en">' + esc(e.en) + '</span>' : '') + '</h3>' +
             '<p class="night-item__text">' + inline(e.text) + '</p>' +
             '</li>';
    }).join('');
  }

  function renderNightOrder(doc, phase, list) {
    var key = phase === 'first' ? 'night_order_first' : 'night_order_other';

    var entries = [];

    (doc.characters || []).forEach(function (ch) {
      if (ch[key] == null) return;
      entries.push(nightEntryFromCharacter(ch, ch[key]));
    });

    var meta = (doc.night_meta && doc.night_meta[phase]) || [];
    meta.forEach(function (m) { entries.push(nightEntryFromMeta(m)); });

    entries.sort(function (a, b) { return a.order - b.order; });

    renderNightSteps(entries, list, 'Für diese Edition sind keine Nachtschritte hinterlegt.');
  }

  BOTC.renderRules = renderRules;
  BOTC.renderGlossary = renderGlossary;
  BOTC.renderCards = renderCards;
  BOTC.renderNightOrder = renderNightOrder;
  BOTC.renderNightSteps = renderNightSteps;
  BOTC.nightEntryFromCharacter = nightEntryFromCharacter;
  BOTC.nightEntryFromMeta = nightEntryFromMeta;

})(window.BOTC);
