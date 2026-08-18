/* ============================================================
   scripts.js — eigene, editionsübergreifende Skripte
   Speicherung im localStorage des Browsers.
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  var KEY = 'botc-regelwiki:scripts:v1';

  /* Alle spielbaren Charaktere aller Editionen, id -> Charakter.
     Wird von app.js nach dem Laden befüllt. */
  var catalog = {};
  var catalogList = [];

  function setCatalog(editions) {
    catalog = {}; catalogList = [];
    Object.keys(editions).forEach(function (edId) {
      var doc = editions[edId];
      (doc.characters || []).forEach(function (ch) {
        if (['townsfolk', 'outsider', 'minion', 'demon'].indexOf(ch.type) === -1) return;
        /* Gleiche id in mehreren Editionen gibt es nicht, aber sicher ist sicher */
        if (catalog[ch.id]) return;
        catalog[ch.id] = ch;
        catalogList.push(ch);
      });
    });
    return catalogList;
  }

  function all() { return catalogList.slice(); }
  function byId(id) { return catalog[id]; }

  /* ---------------------------------------------- Speicherung */

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn('Eigene Skripte konnten nicht gelesen werden:', e);
      return [];
    }
  }

  function persist(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.warn('Eigene Skripte konnten nicht gespeichert werden:', e);
      return false;
    }
  }

  function newId() {
    return 'script-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  function save(script) {
    var list = load();
    var i = -1;
    list.forEach(function (s, idx) { if (s.id === script.id) i = idx; });
    if (!script.id) script.id = newId();
    script.updated = new Date().toISOString();
    if (i >= 0) list[i] = script; else list.push(script);
    persist(list);
    return script;
  }

  function remove(id) {
    persist(load().filter(function (s) { return s.id !== id; }));
  }

  function get(id) {
    var found = null;
    load().forEach(function (s) { if (s.id === id) found = s; });
    return found;
  }

  /* ---------------------------------------------- Aufbereitung */

  /**
   * Macht aus einem gespeicherten Skript ({id, name, characterIds})
   * ein Objekt, das der Generator wie eine Edition behandeln kann.
   */
  function hydrate(script) {
    if (!script) return null;
    var chars = (script.characterIds || []).map(byId).filter(Boolean);
    return {
      edition: script.id,
      name_de: script.name,
      custom: true,
      characters: chars,
      setups: []
    };
  }

  /**
   * Prüft, ob ein Skript für eine Spieleranzahl überhaupt spielbar ist.
   */
  function validate(script, players) {
    var doc = hydrate(script);
    var chars = doc ? doc.characters : [];
    var counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
    chars.forEach(function (c) { counts[c.type]++; });

    var problems = [], warnings = [];
    if (!counts.demon) problems.push('Es ist kein Dämon im Skript.');
    if (!counts.minion) problems.push('Es ist kein Scherge im Skript.');
    if (counts.townsfolk < 3) problems.push('Zu wenige Bürger (mindestens 3).');

    if (players) {
      var need = BOTC.baseDistribution(players);
      /* Setup-Modifikatoren können den Außenseiter-Bedarf erhöhen */
      var maxOutsiderNeed = need.outsider;
      chars.forEach(function (c) {
        if (c.setup_modifier && c.setup_modifier.outsider > 0) {
          maxOutsiderNeed = Math.max(maxOutsiderNeed, need.outsider + c.setup_modifier.outsider);
        }
        if (c.setup_modifier && c.setup_modifier.outsider_choice) {
          maxOutsiderNeed = Math.max(maxOutsiderNeed, need.outsider + 1);
        }
      });

      /* „1 Scherge wird" vs. „2 Schergen werden" */
      function need_(count, one, many) {
        return count === 1
          ? ('wird 1 ' + one + ' gebraucht')
          : ('werden ' + count + ' ' + many + ' gebraucht');
      }

      if (counts.townsfolk < need.townsfolk) {
        problems.push('Für ' + players + ' Spieler ' + need_(need.townsfolk, 'Bürger', 'Bürger') +
                      ', im Skript ' + (counts.townsfolk === 1 ? 'ist 1' : 'sind ' + counts.townsfolk) + '.');
      }
      if (counts.minion < need.minion) {
        problems.push('Für ' + players + ' Spieler ' + need_(need.minion, 'Scherge', 'Schergen') +
                      ', im Skript ' + (counts.minion === 1 ? 'ist 1' : 'sind ' + counts.minion) + '.');
      }
      if (counts.outsider < maxOutsiderNeed) {
        warnings.push('Für ' + players + ' Spieler ' +
                      (maxOutsiderNeed === 1 ? 'kann bis zu 1 Außenseiter' : 'können bis zu ' + maxOutsiderNeed + ' Außenseiter') +
                      ' nötig sein, im Skript ' + (counts.outsider === 1 ? 'ist 1' : 'sind ' + counts.outsider) + '.');
      }
      /* Bluffs brauchen nicht im Spiel befindliche gute Charaktere */
      var goodTotal = counts.townsfolk + counts.outsider;
      if (goodTotal < need.townsfolk + need.outsider + 3) {
        warnings.push('Für 3 vollwertige Bluffs sollten mindestens 3 gute Charaktere übrig bleiben.');
      }
    }

    return { counts: counts, problems: problems, warnings: warnings, ok: problems.length === 0 };
  }

  /**
   * Näherungsweise Nachtreihenfolge für editionsübergreifende Skripte.
   *
   * Es gibt keine offizielle Reihenfolge für gemischte Skripte. Alle drei
   * Editionen folgen aber derselben Logik (erst Gesinnungs- und Störeffekte,
   * dann Schutz, dann Dämonen, dann Informationen, zuletzt Beobachter).
   * Deshalb wird die relative Position innerhalb der Herkunftsedition auf
   * 0..1 normalisiert und danach sortiert.
   */
  function approximateNightOrder(script, editions, phase) {
    var doc = hydrate(script);
    var key = phase === 'first' ? 'night_order_first' : 'night_order_other';

    var maxima = {};
    Object.keys(editions).forEach(function (edId) {
      var ed = editions[edId];
      var max = 0;
      (ed.characters || []).forEach(function (c) { if (c[key] > max) max = c[key]; });
      ((ed.night_meta && ed.night_meta[phase]) || []).forEach(function (m) {
        if (m.order > max) max = m.order;
      });
      maxima[edId] = max || 1;
    });

    return doc.characters
      .filter(function (ch) { return ch[key] != null; })
      .map(function (ch) {
        return { ch: ch, rel: ch[key] / (maxima[ch.edition] || 1) };
      })
      .sort(function (a, b) { return a.rel - b.rel; })
      .map(function (e, i) { return { order: i + 1, character: e.ch, relative: e.rel }; });
  }

  BOTC.scripts = {
    setCatalog: setCatalog,
    all: all,
    byId: byId,
    load: load,
    save: save,
    remove: remove,
    get: get,
    hydrate: hydrate,
    validate: validate,
    approximateNightOrder: approximateNightOrder,
    newId: newId
  };

})(window.BOTC);
