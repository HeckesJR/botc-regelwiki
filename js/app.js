/* ============================================================
   app.js — Daten laden, Tabs, Zustand und Verdrahtung aller Module
   ============================================================ */

(function () {
  'use strict';

  var BOTC = window.BOTC;

  var EDITIONS = [
    { id: 'trouble_brewing', file: 'data/trouble_brewing.json', label: 'Trouble Brewing' },
    { id: 'bad_moon_rising', file: 'data/bad_moon_rising.json', label: 'Bad Moon Rising' },
    { id: 'sects_violets',   file: 'data/sects_violets.json',   label: 'Sects & Violets' },
    { id: 'traveller_fabled', file: 'data/traveller_fabled.json', label: 'Reisende & Fabled' }
  ];

  /* Editionen mit eigener Nachtreihenfolge und eigenen Setups */
  var PLAYABLE = ['trouble_brewing', 'bad_moon_rising', 'sects_violets'];

  var state = {
    rules: null,
    glossary: null,
    editions: {},              /* id -> geladenes JSON */
    charEdition: 'trouble_brewing',
    charTypes: new Set(),
    charQuery: '',
    nightEdition: 'trouble_brewing',
    nightPhase: 'first',
    lastResult: null           /* letztes Generator-Ergebnis für den PDF-Export */
  };

  var $ = function (sel) { return document.querySelector(sel); };

  /* ---------------------------------------------- Laden */

  function loadJSON(path) {
    return fetch(path).then(function (res) {
      if (!res.ok) throw new Error(path + ' → HTTP ' + res.status);
      return res.json();
    });
  }

  function boot() {
    Promise.all([
      loadJSON('data/grundregeln_de.json'),
      loadJSON('data/glossar_de.json'),
      loadJSON('data/balance.json')
    ].concat(EDITIONS.map(function (e) { return loadJSON(e.file); })))
      .then(function (results) {
        state.rules = results[0];
        state.glossary = results[1];
        BOTC.setBalance(results[2]);
        EDITIONS.forEach(function (e, i) { state.editions[e.id] = results[i + 3]; });

        /* Katalog für eigene Skripte: nur die drei spielbaren Editionen */
        var playable = {};
        PLAYABLE.forEach(function (id) { playable[id] = state.editions[id]; });
        BOTC.scripts.setCatalog(playable);

        init();
      })
      .catch(function (err) {
        console.error(err);
        var root = $('#rules-root');
        if (root) {
          root.innerHTML =
            '<div class="note"><strong>Daten konnten nicht geladen werden.</strong> ' +
            BOTC.esc(err.message) + '<br><br>' +
            'Wird die Seite direkt per Doppelklick geöffnet (<code>file://</code>), blockiert der Browser ' +
            'das Nachladen der JSON-Dateien. Starte einen lokalen Webserver oder öffne die Seite über ' +
            'GitHub Pages.</div>';
        }
      });
  }

  /* ---------------------------------------------- Tabs */

  /* Der Teil hinter dem Schrägstrich ist der Unterweg, etwa #termine/a7f3k9.
     Nur der Termine-Tab benutzt ihn zurzeit — damit ein aus WhatsApp
     kopierter Link direkt die richtige Abfrage öffnet. */
  function routeFromHash() {
    var teile = location.hash.slice(1).split('/');
    return { tab: teile[0] || '', sub: teile.slice(1).join('/') };
  }

  function initTabs() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.tab'));

    function activate(name, sub) {
      tabs.forEach(function (t) {
        var on = t.dataset.tab === name;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('.panel').forEach(function (p) {
        var on = p.dataset.panel === name;
        p.classList.toggle('is-active', on);
        p.hidden = !on;
      });

      var ziel = '#' + name + (sub ? '/' + sub : '');
      if (location.hash !== ziel) history.replaceState(null, '', ziel);

      if (name === 'termine' && BOTC.termine) BOTC.termine.show(sub || '');
    }

    /* Damit andere Module dorthin springen können, ohne die Tabs zu kennen */
    BOTC.gotoTab = activate;

    tabs.forEach(function (t) {
      /* Tab-Klick heißt: zurück auf die Übersicht, ohne Unterweg */
      t.addEventListener('click', function () { activate(t.dataset.tab, ''); });
    });

    /* Ein eingefügter Link, während die Seite schon offen ist */
    window.addEventListener('hashchange', function () {
      var r = routeFromHash();
      if (r.tab && tabs.some(function (t) { return t.dataset.tab === r.tab; })) {
        activate(r.tab, r.sub);
      }
    });

    /* Pfeiltasten-Navigation zwischen den Tabs */
    $('.tabs__inner').addEventListener('keydown', function (ev) {
      var i = tabs.indexOf(document.activeElement);
      if (i === -1) return;
      var next = null;
      if (ev.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      if (ev.key === 'ArrowLeft')  next = tabs[(i - 1 + tabs.length) % tabs.length];
      if (!next) return;
      ev.preventDefault();
      next.focus();
      activate(next.dataset.tab);
    });

    var start = routeFromHash();
    if (start.tab && tabs.some(function (t) { return t.dataset.tab === start.tab; })) {
      activate(start.tab, start.sub);
    }
  }

  /* ---------------------------------------------- Chips */

  function makeChip(label, opts) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip' + (opts.active ? ' is-active' : '');
    b.textContent = label;
    Object.keys(opts.data || {}).forEach(function (k) { b.dataset[k] = opts.data[k]; });
    if (opts.tone) b.dataset.tone = opts.tone;
    if (opts.pressed !== undefined) b.setAttribute('aria-pressed', String(opts.pressed));
    return b;
  }

  /* ---------------------------------------------- Charaktere */

  /* Charaktere der aktiven Edition. Für die drei spielbaren Editionen werden
     zusätzlich die fünf Reisenden eingemischt, die zu dieser Edition gehören —
     Fabled bleiben editionsunabhängig im eigenen Bereich. */
  function currentCharacters() {
    var doc = state.editions[state.charEdition];
    var list = (doc && doc.characters) || [];

    if (PLAYABLE.indexOf(state.charEdition) !== -1) {
      var extra = state.editions.traveller_fabled;
      if (extra && extra.characters) {
        list = list.concat(extra.characters.filter(function (ch) {
          return ch.type === 'traveller' && ch.edition === state.charEdition;
        }));
      }
    }
    return list;
  }

  function renderCharacterTab() {
    var all = currentCharacters();
    var filtered = BOTC.filterCharacters(all, {
      types: state.charTypes,
      query: state.charQuery
    });

    BOTC.renderCards(filtered, $('#char-grid'));
    $('#char-count').textContent = BOTC.countLabel(filtered.length, all.length);
    $('#char-empty').hidden = filtered.length > 0;
  }

  function buildTypeFilter() {
    var box = $('#type-filter');
    box.innerHTML = '';
    var types = BOTC.availableTypes(currentCharacters());

    /* Typen, die diese Edition nicht kennt, tauchen gar nicht erst auf */
    state.charTypes.forEach(function (t) {
      if (types.indexOf(t) === -1) state.charTypes.delete(t);
    });

    types.forEach(function (type) {
      var tone = BOTC.TYPE_TONE[type];
      var chip = makeChip(BOTC.TYPE_LABEL[type] || type, {
        data: { type: type },
        tone: tone === 'neutral' ? null : tone,
        active: state.charTypes.has(type),
        pressed: state.charTypes.has(type)
      });
      chip.addEventListener('click', function () {
        if (state.charTypes.has(type)) state.charTypes.delete(type);
        else state.charTypes.add(type);
        chip.classList.toggle('is-active');
        chip.setAttribute('aria-pressed', String(state.charTypes.has(type)));
        renderCharacterTab();
      });
      box.appendChild(chip);
    });
  }

  function initCharacterTab() {
    var editionBox = $('#edition-switch');
    EDITIONS.forEach(function (e) {
      var chip = makeChip(e.label, {
        data: { edition: e.id },
        active: e.id === state.charEdition,
        pressed: e.id === state.charEdition
      });
      chip.addEventListener('click', function () {
        state.charEdition = e.id;
        editionBox.querySelectorAll('.chip').forEach(function (c) {
          var on = c.dataset.edition === e.id;
          c.classList.toggle('is-active', on);
          c.setAttribute('aria-pressed', String(on));
        });
        buildTypeFilter();
        renderCharacterTab();
      });
      editionBox.appendChild(chip);
    });

    var search = $('#char-search');
    var timer = null;
    search.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.charQuery = search.value;
        renderCharacterTab();
      }, 120);
    });

    $('#char-reset').addEventListener('click', function () {
      state.charTypes.clear();
      state.charQuery = '';
      search.value = '';
      buildTypeFilter();
      renderCharacterTab();
    });

    /* Karten aufklappen (Delegation, damit neu gerenderte Karten mitmachen) */
    var grid = $('#char-grid');
    function toggleCard(card) {
      var open = card.classList.toggle('is-open');
      card.setAttribute('aria-expanded', String(open));
      card.querySelector('.card__hint').textContent = open ? 'Klicken zum Schließen' : 'Klicken für Details';
    }
    grid.addEventListener('click', function (ev) {
      var card = ev.target.closest('.card');
      if (card) toggleCard(card);
    });
    grid.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var card = ev.target.closest('.card');
      if (!card) return;
      ev.preventDefault();
      toggleCard(card);
    });

    /* Fehlt ein offizielles Icon, still auf das mitgelieferte SVG-Emblem zurückfallen.
       error-Events steigen nicht auf, deshalb in der Capture-Phase lauschen. */
    grid.addEventListener('error', function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== 'IMG' || !img.dataset.fallback) return;
      var fb = img.dataset.fallback;
      delete img.dataset.fallback;
      img.src = fb;
    }, true);

    buildTypeFilter();
    renderCharacterTab();
  }

  /* ---------------------------------------------- Nachtreihenfolge */

  function isScriptId(id) { return String(id).indexOf('script-') === 0; }

  /* Die Rahmenschritte (Abenddämmerung, Schergen- und Dämon-Info,
     Morgendämmerung) sind in allen drei Editionen dieselben. Für eigene
     Skripte werden sie deshalb aus Trouble Brewing übernommen, statt sie
     im Code zu doppeln. Der Eintrag mit der höchsten Nummer ist immer die
     Morgendämmerung, alle anderen leiten die Nacht ein. */
  function frameSteps(phase) {
    var meta = ((state.editions.trouble_brewing || {}).night_meta || {})[phase] || [];
    if (!meta.length) return { opening: [], closing: null };
    var sorted = meta.slice().sort(function (a, b) { return a.order - b.order; });
    return { opening: sorted.slice(0, -1), closing: sorted[sorted.length - 1] };
  }

  function renderApproxNightTab(script) {
    var steps = BOTC.scripts.approximateNightOrder(script, state.editions, state.nightPhase);
    var frame = frameSteps(state.nightPhase);
    var entries = [];
    var n = 0;

    frame.opening.forEach(function (m) { entries.push(BOTC.nightEntryFromMeta(m, ++n)); });
    steps.forEach(function (s) { entries.push(BOTC.nightEntryFromCharacter(s.character, ++n)); });
    if (frame.closing) entries.push(BOTC.nightEntryFromMeta(frame.closing, ++n));

    /* Nur die Rahmenschritte heißt: kein Charakter des Skripts wacht in dieser
       Phase auf. Dann ist die Liste ohne Aussage. */
    if (!steps.length) {
      BOTC.renderNightSteps([], $('#night-list'),
        'In diesem Skript wacht in dieser Nacht kein Charakter auf.');
      return;
    }

    BOTC.renderNightSteps(entries, $('#night-list'));
  }

  function renderNightTab() {
    var note = $('#night-approx-note');
    var id = state.nightEdition;

    if (isScriptId(id)) {
      var script = BOTC.scripts.get(id);
      if (script) {
        note.hidden = false;
        renderApproxNightTab(script);
        return;
      }
      /* Skript wurde zwischenzeitlich gelöscht */
      state.nightEdition = PLAYABLE[0];
      refreshNightScripts();
      return;
    }

    note.hidden = true;
    BOTC.renderNightOrder(state.editions[id], state.nightPhase, $('#night-list'));
  }

  function selectNightScript(id) {
    state.nightEdition = id;
    $('#night-edition-switch').querySelectorAll('.chip').forEach(function (c) {
      var on = c.dataset.edition === id;
      c.classList.toggle('is-active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    renderNightTab();
  }

  /* Baut die Auswahl neu: die drei Editionen, danach die gespeicherten
     eigenen Skripte. Wird auch nach Speichern und Löschen aufgerufen. */
  function refreshNightScripts() {
    var box = $('#night-edition-switch');
    box.innerHTML = '';

    var choices = PLAYABLE.map(function (id) {
      var e = EDITIONS.filter(function (x) { return x.id === id; })[0];
      return { id: id, label: e.label, own: false };
    });

    BOTC.scripts.load().forEach(function (s) {
      choices.push({ id: s.id, label: s.name, own: true });
    });

    /* Zeigt das aktive Skript noch auf etwas Vorhandenes? */
    var stillThere = choices.some(function (c) { return c.id === state.nightEdition; });
    if (!stillThere) state.nightEdition = PLAYABLE[0];

    choices.forEach(function (c) {
      var chip = makeChip(c.label, {
        data: { edition: c.id },
        active: c.id === state.nightEdition,
        pressed: c.id === state.nightEdition
      });
      if (c.own) chip.classList.add('chip--own');
      chip.addEventListener('click', function () { selectNightScript(c.id); });
      box.appendChild(chip);
    });

    renderNightTab();
  }

  function initNightTab() {
    $('#night-phase-switch').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.chip');
      if (!btn) return;
      state.nightPhase = btn.dataset.phase;
      this.querySelectorAll('.chip').forEach(function (c) {
        c.classList.toggle('is-active', c === btn);
      });
      renderNightTab();
    });

    state.refreshNightScripts = refreshNightScripts;
    refreshNightScripts();
  }

  /* ---------------------------------------------- Generator */

  function distributionMarkup(result) {
    var d = result.suggestions.length ? result.suggestions[0].distribution : result.base;
    var cells = [
      { label: 'Bürger', value: d.townsfolk, tone: 'good' },
      { label: 'Außenseiter', value: d.outsider, tone: 'good' },
      { label: 'Schergen', value: d.minion, tone: 'evil' },
      { label: 'Dämon', value: d.demon, tone: 'evil' }
    ];
    if (result.travellers > 0) {
      cells.push({ label: 'Reisende', value: result.travellers, tone: 'traveller' });
    }

    var html = '<p class="distribution__title">Grundverteilung für ' + result.players + ' Spieler</p>' +
      '<div class="distribution__grid">' +
      cells.map(function (c) {
        return '<div class="dist-cell" data-tone="' + c.tone + '">' +
               '<span class="dist-cell__value">' + c.value + '</span>' +
               '<span class="dist-cell__label">' + BOTC.esc(c.label) + '</span></div>';
      }).join('') + '</div>';

    if (result.travellers > 0) {
      html += '<p class="dist-note">Ab 16 Spielern bleibt die Grundverteilung wie bei 15 Spielern — ' +
              'jeder weitere Spieler ist ein Reisender.</p>';
    }
    return html;
  }

  function setupMarkup(s, index) {
    var groups = [
      { type: 'townsfolk', label: 'Bürger', tone: 'good' },
      { type: 'outsider',  label: 'Außenseiter', tone: 'good' },
      { type: 'minion',    label: 'Schergen', tone: 'evil' },
      { type: 'demon',     label: 'Dämon', tone: 'evil' }
    ];

    var badges = [];
    badges.push('<span class="badge">' +
      (s.curated ? 'Aus dem Regelwerk' : (s.balanced ? 'Ausgewogen gezogen' : 'Zusammengestellt')) +
      '</span>');
    if (s.difficulty) badges.push('<span class="badge">' + BOTC.esc(s.difficulty) + '</span>');
    if (!s.exact && s.originalPlayers) {
      badges.push('<span class="badge">Vorlage für ' + s.originalPlayers + ' Spieler, erweitert</span>');
    }
    if (s.score) {
      var tone = s.score.score >= 65 ? 'good' : (s.score.score >= 45 ? 'mid' : 'weak');
      badges.push('<span class="badge badge--score" data-tone="' + tone + '">Balance ' + s.score.score + '/100</span>');
    }

    var html = '<article class="setup" data-index="' + index + '">' +
      '<div class="setup__head"><h3 class="setup__name">' + BOTC.esc(s.name) + '</h3>' +
      '<div class="setup__badges">' + badges.join('') + '</div></div>' +
      '<p class="setup__reason">' + BOTC.inline(s.reason) + '</p>' +
      '<div class="setup__groups">';

    groups.forEach(function (g) {
      var members = s.characters.filter(function (ch) { return ch.type === g.type; });
      if (!members.length) return;
      html += '<div class="setup__group" data-tone="' + g.tone + '">' +
              '<h4 class="setup__group-title">' + g.label + ' (' + members.length + ')</h4><ul>' +
              members.map(function (ch) {
                return '<li>' + BOTC.esc(ch.name_de) +
                       ' <span class="en">' + BOTC.esc(ch.name_en) + '</span></li>';
              }).join('') + '</ul></div>';
    });

    html += '</div>';

    /* Bluffs: die 3 nicht im Spiel befindlichen guten Charaktere für den Dämon */
    if (s.bluffs && s.bluffs.length) {
      html += '<div class="bluffs"><h4 class="bluffs__title">Bluffs für den Dämon</h4>' +
              '<p class="bluffs__hint">Diese guten Charaktere sind <strong>nicht</strong> im Spiel — ' +
              'zeige sie dem Dämon in der ersten Nacht, damit er sich damit tarnen kann.</p>' +
              '<ul class="bluffs__list">' +
              s.bluffs.map(function (ch) {
                return '<li class="bluff" data-type="' + BOTC.esc(ch.type) + '">' +
                       '<img class="bluff__icon" src="' + BOTC.esc(ch.icon) + '" alt="" aria-hidden="true" ' +
                       'data-fallback="' + BOTC.esc(String(ch.icon).replace(/\.webp$/, '.svg')) + '">' +
                       '<span class="bluff__name">' + BOTC.esc(ch.name_de) + '</span>' +
                       '<span class="bluff__type">' + BOTC.esc(BOTC.TYPE_LABEL[ch.type] || ch.type) + '</span>' +
                       '</li>';
              }).join('') +
              '</ul>' +
              '<button type="button" class="btn btn--ghost btn--sm" data-rebluff="' + index + '">Andere Bluffs</button>' +
              '</div>';
    }

    if (s.modifierNotes && s.modifierNotes.length) {
      html += '<div class="note">Verteilung angepasst: ' +
              s.modifierNotes.map(BOTC.esc).join(' · ') + '</div>';
    }
    if (s.missing && s.missing.length) {
      html += '<div class="note">Nicht vollständig auffüllbar — es fehlen ' +
              s.missing.map(BOTC.esc).join(', ') +
              '. Dieses Skript hat dafür zu wenige Charaktere.</div>';
    }

    html += '<div class="setup__actions">' +
            '<button type="button" class="btn btn--primary" data-pdf="' + index + '">Als PDF speichern</button>' +
            '</div></article>';

    return html;
  }

  function showResult(result) {
    state.lastResult = result;
    $('#gen-distribution').innerHTML = distributionMarkup(result);
    $('#gen-results').innerHTML = result.suggestions.map(setupMarkup).join('');
  }

  /* Liefert das aktive Skript: entweder eine Edition oder ein eigenes Skript. */
  function currentGenScript() {
    var v = $('#gen-edition').value;
    if (v.indexOf('script-') === 0) {
      return BOTC.scripts.hydrate(BOTC.scripts.get(v));
    }
    return state.editions[v];
  }

  function currentGenLabel() {
    var sel = $('#gen-edition');
    return sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent : '';
  }

  /* Skript-Auswahlfeld neu aufbauen (Editionen + gespeicherte eigene Skripte). */
  function refreshGenScripts() {
    var select = $('#gen-edition');
    var previous = select.value;
    select.innerHTML = '';

    var gEd = document.createElement('optgroup');
    gEd.label = 'Editionen';
    PLAYABLE.forEach(function (id) {
      var e = EDITIONS.filter(function (x) { return x.id === id; })[0];
      var opt = document.createElement('option');
      opt.value = id; opt.textContent = e.label;
      gEd.appendChild(opt);
    });
    select.appendChild(gEd);

    var own = BOTC.scripts.load();
    if (own.length) {
      var gOwn = document.createElement('optgroup');
      gOwn.label = 'Eigene Skripte';
      own.forEach(function (s) {
        var opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name + ' (' + (s.characterIds || []).length + ')';
        gOwn.appendChild(opt);
      });
      select.appendChild(gOwn);
    }

    if (previous) {
      var stillThere = Array.prototype.some.call(select.options, function (o) { return o.value === previous; });
      if (stillThere) select.value = previous;
    }
  }

  function initGeneratorTab() {
    refreshGenScripts();
    var select = $('#gen-edition');
    var playersInput = $('#gen-players');

    function readPlayers() {
      var n = parseInt(playersInput.value, 10);
      if (isNaN(n)) n = 8;
      n = Math.max(BOTC.MIN_PLAYERS, Math.min(BOTC.MAX_PLAYERS, n));
      playersInput.value = n;
      return n;
    }

    /* Prüft eigene Skripte gegen die Spieleranzahl und zeigt Hinweise an. */
    function checkScript(n) {
      var hint = $('#gen-hint');
      var v = select.value;
      if (v.indexOf('script-') !== 0) { hint.hidden = true; return true; }

      var res = BOTC.scripts.validate(BOTC.scripts.get(v), n);
      var msgs = res.problems.concat(res.warnings);
      if (!msgs.length) { hint.hidden = true; return true; }
      hint.hidden = false;
      hint.className = 'gen-hint' + (res.problems.length ? ' gen-hint--error' : '');
      hint.innerHTML = msgs.map(BOTC.esc).join('<br>');
      return res.ok;
    }

    function run(mode) {
      var n = readPlayers();
      if (!checkScript(n)) { $('#gen-results').innerHTML = ''; $('#gen-distribution').innerHTML = ''; return; }
      var script = currentGenScript();
      var result;
      if (mode === 'balanced') result = BOTC.balancedSetups(script, n, { count: 3 });
      else if (mode === 'random') result = BOTC.randomSetup(script, n);
      else result = BOTC.suggestSetups(script, n);

      if (result.error) {
        $('#gen-distribution').innerHTML = '';
        $('#gen-results').innerHTML = '<div class="note">' + BOTC.esc(result.error) + '</div>';
        state.lastResult = null;
        return;
      }
      showResult(result);
    }

    /* Skriptblatt des gerade gewählten Skripts (Edition oder eigenes) */
    $('#gen-sheet').addEventListener('click', function () {
      var script = currentGenScript();
      if (!script || !script.characters) return;
      var btn = this;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Erzeuge PDF …';
      BOTC.pdf.exportScriptSheet(script.characters, {
        name: currentGenLabel().replace(/\s*\(\d+\)$/, ''),
        subtitle: 'Blood on the Clocktower · Charakterblatt'
      }).catch(function (e) {
        console.error(e);
      }).then(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
    });

    $('#generator-form').addEventListener('submit', function (ev) { ev.preventDefault(); run('suggest'); });
    $('#gen-balanced').addEventListener('click', function () { run('balanced'); });
    $('#gen-random').addEventListener('click', function () { run('random'); });
    select.addEventListener('change', function () { run('suggest'); });
    playersInput.addEventListener('change', function () { run('suggest'); });

    $('#gen-results').addEventListener('click', function (ev) {
      if (!state.lastResult) return;

      /* Neue Bluffs würfeln, ohne das Setup zu ändern */
      var reb = ev.target.closest('[data-rebluff]');
      if (reb) {
        var idx = parseInt(reb.dataset.rebluff, 10);
        var sug = state.lastResult.suggestions[idx];
        if (!sug) return;
        var pool = (currentGenScript().characters || []);
        sug.bluffs = BOTC.pickBluffs(pool, sug.characters);
        $('#gen-results').innerHTML = state.lastResult.suggestions.map(setupMarkup).join('');
        return;
      }

      var btn = ev.target.closest('[data-pdf]');
      if (!btn) return;
      var s = state.lastResult.suggestions[parseInt(btn.dataset.pdf, 10)];
      if (!s) return;
      BOTC.pdf.exportSetup(s, {
        editionName: currentGenLabel(),
        players: state.lastResult.players,
        travellers: state.lastResult.travellers
      });
    });

    /* Icon-Fallback auch für Bluff-Bilder */
    $('#gen-results').addEventListener('error', function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== 'IMG' || !img.dataset.fallback) return;
      var fb = img.dataset.fallback;
      delete img.dataset.fallback;
      img.src = fb;
    }, true);

    state.refreshGenScripts = refreshGenScripts;
    state.runGenerator = run;

    /* Erster Vorschlag direkt beim Öffnen */
    run('suggest');
  }

  /* ---------------------------------------------- Eigene Skripte */

  var builder = {
    id: null,
    selected: new Set(),
    editions: new Set(),
    types: new Set(),
    query: ''
  };

  function builderStatus() {
    var box = $('#script-status');
    var chars = [...builder.selected].map(BOTC.scripts.byId).filter(Boolean);
    var counts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
    chars.forEach(function (c) { counts[c.type]++; });

    if (!chars.length) {
      box.innerHTML = '<p class="script-status__empty">Noch nichts ausgewählt. Klick unten Charaktere an, um sie ins Skript zu nehmen.</p>';
      return;
    }

    var cells = [
      { label: 'Bürger', value: counts.townsfolk, tone: 'good' },
      { label: 'Außenseiter', value: counts.outsider, tone: 'good' },
      { label: 'Schergen', value: counts.minion, tone: 'evil' },
      { label: 'Dämon', value: counts.demon, tone: 'evil' }
    ];

    /* Für welche Spieleranzahlen reicht das Skript? */
    var playable = [];
    for (var n = BOTC.MIN_PLAYERS; n <= 15; n++) {
      var v = BOTC.scripts.validate({ characterIds: [...builder.selected] }, n);
      if (v.ok && !v.problems.length) playable.push(n);
    }

    var html = '<div class="distribution__grid">' + cells.map(function (c) {
      return '<div class="dist-cell" data-tone="' + c.tone + '">' +
             '<span class="dist-cell__value">' + c.value + '</span>' +
             '<span class="dist-cell__label">' + c.label + '</span></div>';
    }).join('') + '</div>';

    var base = BOTC.scripts.validate({ characterIds: [...builder.selected] });
    if (base.problems.length) {
      html += '<div class="note">' + base.problems.map(BOTC.esc).join('<br>') + '</div>';
    }
    html += '<p class="script-status__players">' +
      (playable.length
        ? 'Spielbar für <strong>' + playable.join(', ') + '</strong> Spieler.'
        : 'Für keine Spieleranzahl vollständig — es fehlen noch Charaktere.') +
      '</p>';

    box.innerHTML = html;
  }

  function renderPicker() {
    var list = BOTC.scripts.all();

    if (builder.editions.size) {
      list = list.filter(function (c) { return builder.editions.has(c.edition); });
    }
    list = BOTC.filterCharacters(list, { types: builder.types, query: builder.query });

    var grouped = {};
    list.forEach(function (c) { (grouped[c.type] = grouped[c.type] || []).push(c); });

    var order = ['townsfolk', 'outsider', 'minion', 'demon'];
    var edLabel = {};
    EDITIONS.forEach(function (e) { edLabel[e.id] = e.label; });

    var html = order.filter(function (t) { return grouped[t]; }).map(function (type) {
      return '<div class="picker__group">' +
        '<h4 class="picker__group-title" data-tone="' + BOTC.TYPE_TONE[type] + '">' +
        BOTC.TYPE_LABEL[type] + '</h4><div class="picker__grid">' +
        grouped[type].map(function (ch) {
          var on = builder.selected.has(ch.id);
          return '<button type="button" class="pick' + (on ? ' is-on' : '') + '" data-id="' +
            BOTC.esc(ch.id) + '" data-type="' + BOTC.esc(ch.type) + '" aria-pressed="' + on + '">' +
            '<img class="pick__icon" src="' + BOTC.esc(ch.icon) + '" alt="" aria-hidden="true" loading="lazy" ' +
            'data-fallback="' + BOTC.esc(String(ch.icon).replace(/\.webp$/, '.svg')) + '">' +
            '<span class="pick__name">' + BOTC.esc(ch.name_de) + '</span>' +
            '<span class="pick__edition">' + BOTC.esc(edLabel[ch.edition] || ch.edition) + '</span>' +
            '</button>';
        }).join('') + '</div></div>';
    }).join('');

    $('#script-picker').innerHTML = html || '<p class="empty-state">Keine Charaktere gefunden.</p>';
  }

  function refreshScriptSelect() {
    var sel = $('#script-select');
    var saved = BOTC.scripts.load();
    sel.innerHTML = '<option value="">— neues Skript —</option>' +
      saved.map(function (s) {
        return '<option value="' + BOTC.esc(s.id) + '"' + (s.id === builder.id ? ' selected' : '') +
               '>' + BOTC.esc(s.name) + '</option>';
      }).join('');
  }

  function loadIntoBuilder(id) {
    var s = id ? BOTC.scripts.get(id) : null;
    builder.id = s ? s.id : null;
    builder.selected = new Set(s ? (s.characterIds || []) : []);
    $('#script-name').value = s ? s.name : '';
    refreshScriptSelect();
    renderPicker();
    builderStatus();
  }

  function initScriptsTab() {
    /* Filter-Chips */
    var edBox = $('#script-edition-filter');
    PLAYABLE.forEach(function (id) {
      var e = EDITIONS.filter(function (x) { return x.id === id; })[0];
      var chip = makeChip(e.label, { data: { edition: id }, active: false, pressed: false });
      chip.addEventListener('click', function () {
        if (builder.editions.has(id)) builder.editions.delete(id); else builder.editions.add(id);
        chip.classList.toggle('is-active');
        chip.setAttribute('aria-pressed', String(builder.editions.has(id)));
        renderPicker();
      });
      edBox.appendChild(chip);
    });

    var typeBox = $('#script-type-filter');
    ['townsfolk', 'outsider', 'minion', 'demon'].forEach(function (type) {
      var tone = BOTC.TYPE_TONE[type];
      var chip = makeChip(BOTC.TYPE_LABEL[type], {
        data: { type: type }, tone: tone === 'neutral' ? null : tone, active: false, pressed: false
      });
      chip.addEventListener('click', function () {
        if (builder.types.has(type)) builder.types.delete(type); else builder.types.add(type);
        chip.classList.toggle('is-active');
        chip.setAttribute('aria-pressed', String(builder.types.has(type)));
        renderPicker();
      });
      typeBox.appendChild(chip);
    });

    var search = $('#script-search');
    var t = null;
    search.addEventListener('input', function () {
      clearTimeout(t);
      t = setTimeout(function () { builder.query = search.value; renderPicker(); }, 120);
    });

    /* Charaktere an- und abwählen */
    var picker = $('#script-picker');
    picker.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.pick');
      if (!btn) return;
      var id = btn.dataset.id;
      if (builder.selected.has(id)) builder.selected.delete(id); else builder.selected.add(id);
      btn.classList.toggle('is-on');
      btn.setAttribute('aria-pressed', String(builder.selected.has(id)));
      builderStatus();
    });
    picker.addEventListener('error', function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== 'IMG' || !img.dataset.fallback) return;
      var fb = img.dataset.fallback;
      delete img.dataset.fallback;
      img.src = fb;
    }, true);

    /* Speichern / Neu / Löschen */
    $('#script-save').addEventListener('click', function () {
      var name = $('#script-name').value.trim();
      if (!name) { $('#script-name').focus(); return; }
      if (!builder.selected.size) return;
      var saved = BOTC.scripts.save({
        id: builder.id, name: name, characterIds: [...builder.selected]
      });
      builder.id = saved.id;
      refreshScriptSelect();
      if (state.refreshGenScripts) state.refreshGenScripts();
      if (state.refreshNightScripts) state.refreshNightScripts();
      var box = $('#script-status');
      box.insertAdjacentHTML('afterbegin',
        '<p class="script-saved">Gespeichert — „' + BOTC.esc(name) + '\" steht jetzt im Generator und in der Nachtreihenfolge zur Auswahl.</p>');
      setTimeout(function () {
        var el = box.querySelector('.script-saved');
        if (el) el.remove();
      }, 4000);
    });

    /* Skriptblatt zum Ausdrucken */
    $('#script-sheet').addEventListener('click', function () {
      var chars = [...builder.selected].map(BOTC.scripts.byId).filter(Boolean);
      if (!chars.length) {
        $('#script-status').insertAdjacentHTML('afterbegin',
          '<p class="script-saved script-saved--warn">Wähle erst Charaktere aus, dann gibt es etwas zu drucken.</p>');
        setTimeout(function () {
          var el = $('#script-status').querySelector('.script-saved--warn');
          if (el) el.remove();
        }, 4000);
        return;
      }
      var btn = this;
      btn.disabled = true;
      var label = btn.textContent;
      btn.textContent = 'Erzeuge PDF …';
      BOTC.pdf.exportScriptSheet(chars, {
        name: ($('#script-name').value.trim() || 'Eigenes Skript'),
        subtitle: chars.length + ' Charaktere · Blood on the Clocktower'
      }).catch(function (e) {
        console.error(e);
      }).then(function () {
        btn.disabled = false;
        btn.textContent = label;
      });
    });

    $('#script-new').addEventListener('click', function () { loadIntoBuilder(null); });

    $('#script-delete').addEventListener('click', function () {
      if (!builder.id) return;
      BOTC.scripts.remove(builder.id);
      loadIntoBuilder(null);
      if (state.refreshGenScripts) state.refreshGenScripts();
      if (state.refreshNightScripts) state.refreshNightScripts();
    });

    $('#script-select').addEventListener('change', function () { loadIntoBuilder(this.value); });

    $('#script-clear').addEventListener('click', function () {
      builder.selected.clear();
      renderPicker();
      builderStatus();
    });

    loadIntoBuilder(null);
  }

  /* ---------------------------------------------- Start */

  function init() {
    BOTC.renderRules(state.rules, $('#rules-root'));
    BOTC.renderGlossary(state.glossary, $('#glossary-root'), '');

    var gs = $('#glossary-search');
    var gtimer = null;
    gs.addEventListener('input', function () {
      clearTimeout(gtimer);
      gtimer = setTimeout(function () {
        BOTC.renderGlossary(state.glossary, $('#glossary-root'), gs.value);
      }, 120);
    });

    /* Vor initTabs(), damit ein Start auf #termine/<id> schon greift */
    BOTC.termine.init();

    initTabs();
    initCharacterTab();
    initNightTab();
    initScriptsTab();
    initGeneratorTab();

    /* Notizen: bekommt Zugriff auf Editionen und eigene Skripte */
    BOTC.notes.init({
      scriptOptions: function () {
        var opts = PLAYABLE.map(function (id) {
          var e = EDITIONS.filter(function (x) { return x.id === id; })[0];
          return { id: id, label: e.label };
        });
        BOTC.scripts.load().forEach(function (s) {
          opts.push({ id: s.id, label: s.name + ' (eigenes Skript)' });
        });
        return opts;
      },
      getScript: function (id) {
        if (id && id.indexOf('script-') === 0) {
          return BOTC.scripts.hydrate(BOTC.scripts.get(id)) || { characters: [] };
        }
        return state.editions[id] || state.editions.trouble_brewing;
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
