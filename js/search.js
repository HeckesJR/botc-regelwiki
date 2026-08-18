/* ============================================================
   search.js — Such- und Filterlogik für den Charaktere-Tab.
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  /* Reihenfolge, in der Typen angezeigt werden */
  var TYPE_ORDER = ['townsfolk', 'outsider', 'minion', 'demon', 'traveller', 'fabled'];

  /* Diakritika entfernen, damit "Buerger"/"Bürger" und "Grossmutter" gleich gut treffen */
  function normalize(str) {
    var s = String(str || '').toLowerCase();
    s = s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
    if (s.normalize) {
      // kombinierende Akzentzeichen entfernen (als RegExp gebaut, damit die
      // Quelldatei keine bloßen Kombinationszeichen enthalten muss)
      s = s.normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');
    }
    return s.replace(/[*·.,;:!?()\[\]"'’„“–—-]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  /* Suchindex einmalig pro Charakter aufbauen und zwischenspeichern */
  function haystack(ch) {
    if (ch.__haystack) return ch.__haystack;
    ch.__haystack = normalize([
      ch.name_de, ch.name_en, ch.ability_short,
      BOTC.TYPE_LABEL[ch.type] || ch.type
    ].join(' '));
    return ch.__haystack;
  }

  /**
   * Filtert eine Charakterliste.
   * @param {Array}  characters  alle Charaktere der aktiven Edition
   * @param {Object} state       { types: Set|Array, query: string }
   */
  function filterCharacters(characters, state) {
    var types = state.types instanceof Set ? state.types : new Set(state.types || []);
    var terms = normalize(state.query).split(' ').filter(Boolean);

    var result = characters.filter(function (ch) {
      if (types.size && !types.has(ch.type)) return false;
      if (!terms.length) return true;

      var hay = haystack(ch);
      return terms.every(function (term) { return hay.indexOf(term) !== -1; });
    });

    return sortCharacters(result);
  }

  /* Sortierung: nach Typ (Bürger → Fabled), darin alphabetisch nach deutschem Namen */
  function sortCharacters(list) {
    return list.slice().sort(function (a, b) {
      var ta = TYPE_ORDER.indexOf(a.type);
      var tb = TYPE_ORDER.indexOf(b.type);
      if (ta !== tb) return ta - tb;
      return a.name_de.localeCompare(b.name_de, 'de');
    });
  }

  /* Welche Typen kommen in dieser Charakterliste überhaupt vor?
     Damit blendet die UI leere Filter-Chips aus. */
  function availableTypes(characters) {
    var seen = {};
    characters.forEach(function (ch) { seen[ch.type] = true; });
    return TYPE_ORDER.filter(function (t) { return seen[t]; });
  }

  function countLabel(shown, total) {
    if (shown === total) {
      return total + (total === 1 ? ' Charakter' : ' Charaktere');
    }
    return shown + ' von ' + total + ' Charakteren';
  }

  BOTC.normalize = normalize;
  BOTC.filterCharacters = filterCharacters;
  BOTC.sortCharacters = sortCharacters;
  BOTC.availableTypes = availableTypes;
  BOTC.countLabel = countLabel;
  BOTC.TYPE_ORDER = TYPE_ORDER;

})(window.BOTC);
