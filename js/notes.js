/* ============================================================
   notes.js — Spielnotizen für während der Partie
   Alles bleibt im localStorage des Geräts, nichts verlässt das Handy.
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  var KEY = 'botc-regelwiki:notes:v1';

  var ALIGN = [
    { id: 'unknown', label: 'unklar' },
    { id: 'good',    label: 'gut' },
    { id: 'evil',    label: 'böse' }
  ];

  var state = null;      /* { script, players: [] } */
  var ctx = null;        /* { editions, playableIds, getScript } */
  var picker = null;     /* offener Rollenwähler */

  /* ---------------------------------------------- Zustand */

  function emptyPlayer(name) {
    return {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name: name || '',
      alive: true,
      ghostVoteUsed: false,
      align: 'unknown',
      claims: [],          /* Rollen, die der Spieler behauptet */
      guesses: {},         /* roleId -> 'suspect' | 'ruled' */
      note: ''
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) {
        var p = JSON.parse(raw);
        if (p && Array.isArray(p.players)) return p;
      }
    } catch (e) {
      console.warn('Notizen konnten nicht gelesen werden:', e);
    }
    return { script: 'trouble_brewing', players: [] };
  }

  var saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try { localStorage.setItem(KEY, JSON.stringify(state)); }
      catch (e) { console.warn('Notizen konnten nicht gespeichert werden:', e); }
    }, 200);
  }

  /* ---------------------------------------------- Hilfen */

  function scriptChars() {
    var doc = ctx.getScript(state.script);
    return (doc && doc.characters || []).filter(function (c) {
      return ['townsfolk', 'outsider', 'minion', 'demon'].indexOf(c.type) !== -1;
    });
  }

  function charById(id) {
    var found = null;
    scriptChars().forEach(function (c) { if (c.id === id) found = c; });
    return found;
  }

  /* Lebende Nachbarn im Sitzkreis — tote werden übersprungen */
  function aliveNeighbours(index) {
    var ps = state.players;
    var alive = ps.filter(function (p) { return p.alive; });
    if (alive.length < 2) return null;

    function walk(dir) {
      for (var step = 1; step < ps.length; step++) {
        var i = (index + dir * step + ps.length * step) % ps.length;
        if (i < 0) i += ps.length;
        if (ps[i].alive && i !== index) return ps[i];
      }
      return null;
    }
    var left = walk(-1), right = walk(1);
    return { left: left, right: right };
  }

  /* ---------------------------------------------- Rendern */

  var esc = function (s) { return BOTC.esc(s); };

  function renderHeader() {
    var doc = ctx.getScript(state.script);
    var n = state.players.length;
    var dist = n >= BOTC.MIN_PLAYERS ? BOTC.baseDistribution(n) : null;

    var options = ctx.scriptOptions().map(function (o) {
      return '<option value="' + esc(o.id) + '"' +
             (o.id === state.script ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');

    var html =
      '<div class="notes-setup">' +
        '<label class="field field--grow">' +
          '<span class="field__label">Skript</span>' +
          '<select id="notes-script">' + options + '</select>' +
        '</label>' +
        '<div class="notes-count">' +
          '<span class="field__label">Spieler</span>' +
          '<strong class="notes-count__value">' + n + '</strong>' +
        '</div>' +
      '</div>';

    if (dist) {
      var cells = [
        { l: 'Bürger', v: dist.townsfolk, t: 'good' },
        { l: 'Außenseiter', v: dist.outsider, t: 'good' },
        { l: 'Schergen', v: dist.minion, t: 'evil' },
        { l: 'Dämon', v: dist.demon, t: 'evil' }
      ];
      if (dist.travellers > 0) cells.push({ l: 'Reisende', v: dist.travellers, t: 'traveller' });

      html += '<div class="distribution__grid notes-dist">' + cells.map(function (c) {
        return '<div class="dist-cell" data-tone="' + c.t + '">' +
               '<span class="dist-cell__value">' + c.v + '</span>' +
               '<span class="dist-cell__label">' + c.l + '</span></div>';
      }).join('') + '</div>';
    } else {
      html += '<p class="notes-hint">Ab ' + BOTC.MIN_PLAYERS +
              ' Spielern wird hier die Verteilung angezeigt.</p>';
    }

    return html;
  }

  /* Welche Rollen hat noch niemand behauptet? */
  function renderOpenRoles() {
    var n = state.players.length;
    if (n < BOTC.MIN_PLAYERS) return '';

    var dist = BOTC.baseDistribution(n);
    var claimed = {};
    state.players.forEach(function (p) {
      p.claims.forEach(function (id) { claimed[id] = true; });
    });

    var groups = [
      { type: 'townsfolk', label: 'Bürger', need: dist.townsfolk, tone: 'good' },
      { type: 'outsider',  label: 'Außenseiter', need: dist.outsider, tone: 'good' },
      { type: 'minion',    label: 'Schergen', need: dist.minion, tone: 'evil' },
      { type: 'demon',     label: 'Dämon', need: dist.demon, tone: 'evil' }
    ];

    var chars = scriptChars();
    var body = groups.map(function (g) {
      var all = chars.filter(function (c) { return c.type === g.type; });
      var open = all.filter(function (c) { return !claimed[c.id]; });
      var have = all.length - open.length;
      return '<div class="open-roles__group" data-tone="' + g.tone + '">' +
        '<h4 class="open-roles__title">' + g.label +
          ' <span class="open-roles__count">' + have + ' von ' + g.need + ' behauptet</span></h4>' +
        (open.length
          ? '<p class="open-roles__list">' + open.map(function (c) {
              return esc(c.name_de);
            }).join(', ') + '</p>'
          : '<p class="open-roles__list open-roles__list--empty">alle behauptet</p>') +
      '</div>';
    }).join('');

    return '<details class="open-roles"><summary>Von niemandem behauptet</summary>' +
           '<div class="open-roles__grid">' + body + '</div></details>';
  }

  function roleChip(ch, mode, stateVal) {
    return '<span class="rolechip" data-mode="' + mode + '"' +
           (stateVal ? ' data-state="' + stateVal + '"' : '') + '>' +
           '<img class="rolechip__icon" src="' + esc(ch.icon) + '" alt="" aria-hidden="true" ' +
           'data-fallback="' + esc(String(ch.icon).replace(/\.webp$/, '.svg')) + '">' +
           '<span>' + esc(ch.name_de) + '</span></span>';
  }

  function renderPlayer(p, i) {
    var nb = aliveNeighbours(i);
    var claims = p.claims.map(charById).filter(Boolean);
    var suspects = Object.keys(p.guesses).filter(function (k) { return p.guesses[k] === 'suspect'; })
                     .map(charById).filter(Boolean);
    var ruled = Object.keys(p.guesses).filter(function (k) { return p.guesses[k] === 'ruled'; })
                     .map(charById).filter(Boolean);

    return '' +
    '<article class="pcard' + (p.alive ? '' : ' is-dead') + '" data-align="' + p.align + '" data-id="' + p.id + '">' +
      '<div class="pcard__head">' +
        '<span class="pcard__seat">' + (i + 1) + '</span>' +
        '<input class="pcard__name" type="text" value="' + esc(p.name) + '" ' +
               'placeholder="Name" data-act="name" autocomplete="off">' +
        '<div class="pcard__move">' +
          '<button type="button" class="iconbtn" data-act="up" aria-label="Nach oben">▲</button>' +
          '<button type="button" class="iconbtn" data-act="down" aria-label="Nach unten">▼</button>' +
          '<button type="button" class="iconbtn iconbtn--del" data-act="remove" aria-label="Entfernen">✕</button>' +
        '</div>' +
      '</div>' +

      (nb && (nb.left || nb.right)
        ? '<p class="pcard__neighbours">Lebende Nachbarn: ' +
          '<strong>' + esc(nb.left ? (nb.left.name || 'Platz ' + (state.players.indexOf(nb.left) + 1)) : '—') + '</strong>' +
          ' · <strong>' + esc(nb.right ? (nb.right.name || 'Platz ' + (state.players.indexOf(nb.right) + 1)) : '—') + '</strong></p>'
        : '') +

      '<div class="pcard__row">' +
        '<div class="seg" role="group" aria-label="Gesinnung">' +
          ALIGN.map(function (a) {
            return '<button type="button" class="seg__btn' + (p.align === a.id ? ' is-on' : '') +
                   '" data-act="align" data-val="' + a.id + '">' + a.label + '</button>';
          }).join('') +
        '</div>' +
        '<div class="seg seg--state" role="group" aria-label="Status">' +
          '<button type="button" class="seg__btn' + (p.alive ? ' is-on' : '') + '" data-act="alive">lebt</button>' +
          '<button type="button" class="seg__btn' + (!p.alive ? ' is-on' : '') + '" data-act="dead">tot</button>' +
          (!p.alive
            ? '<button type="button" class="seg__btn' + (p.ghostVoteUsed ? ' is-on' : '') +
              '" data-act="ghost" title="Geisterstimme verbraucht">Stimme weg</button>'
            : '') +
        '</div>' +
      '</div>' +

      '<div class="pcard__roles">' +
        '<div class="rolerow">' +
          '<button type="button" class="rolerow__label" data-act="pick-claim">Behauptet ＋</button>' +
          '<div class="rolerow__chips">' +
            (claims.length ? claims.map(function (c) { return roleChip(c, 'claim'); }).join('')
                           : '<span class="rolerow__empty">nichts eingetragen</span>') +
          '</div>' +
        '</div>' +
        '<div class="rolerow">' +
          '<button type="button" class="rolerow__label" data-act="pick-guess">Vermutet ＋</button>' +
          '<div class="rolerow__chips">' +
            (suspects.length || ruled.length
              ? suspects.map(function (c) { return roleChip(c, 'guess', 'suspect'); }).join('') +
                ruled.map(function (c) { return roleChip(c, 'guess', 'ruled'); }).join('')
              : '<span class="rolerow__empty">nichts eingetragen</span>') +
          '</div>' +
        '</div>' +
      '</div>' +

      '<textarea class="pcard__note" rows="2" placeholder="Notiz …" data-act="note">' +
        esc(p.note) + '</textarea>' +
    '</article>';
  }

  function render() {
    var root = document.getElementById('notes-root');
    if (!root) return;

    root.innerHTML =
      renderHeader() +
      renderOpenRoles() +
      '<div class="pcards">' +
        (state.players.length
          ? state.players.map(renderPlayer).join('')
          : '<p class="empty-state">Noch keine Spieler. Trag unten den ersten Namen ein.</p>') +
      '</div>' +
      '<form class="notes-add" id="notes-add">' +
        '<input type="text" id="notes-newname" placeholder="Name des Spielers" autocomplete="off">' +
        '<button type="submit" class="btn btn--primary">Hinzufügen</button>' +
      '</form>' +
      '<div class="notes-actions">' +
        '<button type="button" class="btn" data-reset="round">Neue Runde</button>' +
        '<button type="button" class="btn btn--ghost" data-reset="all">Alles löschen</button>' +
      '</div>';
  }

  /* ---------------------------------------------- Rollenwähler */

  function openPicker(playerId, mode) {
    var p = state.players.filter(function (x) { return x.id === playerId; })[0];
    if (!p) return;
    picker = { playerId: playerId, mode: mode };

    var groups = [
      { type: 'townsfolk', label: 'Bürger' },
      { type: 'outsider',  label: 'Außenseiter' },
      { type: 'minion',    label: 'Schergen' },
      { type: 'demon',     label: 'Dämon' }
    ];
    var chars = scriptChars();

    var body = groups.map(function (g) {
      var list = chars.filter(function (c) { return c.type === g.type; });
      if (!list.length) return '';
      return '<div class="picker__group"><h4 class="picker__group-title" data-tone="' +
        BOTC.TYPE_TONE[g.type] + '">' + g.label + '</h4><div class="picker__grid">' +
        list.map(function (c) {
          var st = mode === 'claim'
            ? (p.claims.indexOf(c.id) !== -1 ? 'on' : '')
            : (p.guesses[c.id] || '');
          return '<button type="button" class="pick pick--role" data-role="' + esc(c.id) + '"' +
            ' data-type="' + esc(c.type) + '" data-state="' + st + '">' +
            '<img class="pick__icon" src="' + esc(c.icon) + '" alt="" aria-hidden="true" ' +
            'data-fallback="' + esc(String(c.icon).replace(/\.webp$/, '.svg')) + '">' +
            '<span class="pick__name">' + esc(c.name_de) + '</span></button>';
        }).join('') + '</div></div>';
    }).join('');

    var overlay = document.createElement('div');
    overlay.className = 'sheetover';
    overlay.id = 'role-picker';
    overlay.innerHTML =
      '<div class="sheetover__panel" role="dialog" aria-modal="true" aria-label="Rolle wählen">' +
        '<div class="sheetover__head">' +
          '<h3>' + (mode === 'claim' ? 'Behauptet' : 'Vermutet') + ' — ' +
            esc(p.name || 'Spieler') + '</h3>' +
          '<button type="button" class="btn btn--ghost btn--sm" data-close>Fertig</button>' +
        '</div>' +
        (mode === 'guess'
          ? '<p class="sheetover__hint">Einmal tippen = verdächtig, zweimal = ausgeschlossen, dreimal = zurücksetzen.</p>'
          : '<p class="sheetover__hint">Tippen, um die behauptete Rolle an- oder abzuwählen.</p>') +
        '<div class="sheetover__body">' + body + '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    document.body.classList.add('is-locked');
  }

  function closePicker() {
    var o = document.getElementById('role-picker');
    if (o) o.remove();
    document.body.classList.remove('is-locked');
    picker = null;
    render();
  }

  /* ---------------------------------------------- Verdrahtung */

  function playerAt(el) {
    var card = el.closest('.pcard');
    if (!card) return null;
    var id = card.dataset.id;
    for (var i = 0; i < state.players.length; i++) {
      if (state.players[i].id === id) return { p: state.players[i], i: i };
    }
    return null;
  }

  function init(context) {
    ctx = context;
    state = load();
    render();

    var root = document.getElementById('notes-root');

    /* Icon-Fallback */
    root.addEventListener('error', function (ev) {
      var img = ev.target;
      if (!img || img.tagName !== 'IMG' || !img.dataset.fallback) return;
      var fb = img.dataset.fallback;
      delete img.dataset.fallback;
      img.src = fb;
    }, true);

    /* Texteingaben: ohne Neuzeichnen speichern, sonst springt der Cursor */
    root.addEventListener('input', function (ev) {
      var t = ev.target;
      if (t.id === 'notes-script') return;
      var hit = playerAt(t);
      if (!hit) return;
      if (t.dataset.act === 'name') { hit.p.name = t.value; save(); refreshNeighbourLabels(); }
      if (t.dataset.act === 'note') { hit.p.note = t.value; save(); }
    });

    root.addEventListener('change', function (ev) {
      if (ev.target.id === 'notes-script') {
        state.script = ev.target.value;
        save();
        render();
      }
    });

    root.addEventListener('submit', function (ev) {
      if (ev.target.id !== 'notes-add') return;
      ev.preventDefault();
      var input = document.getElementById('notes-newname');
      var name = input.value.trim();
      state.players.push(emptyPlayer(name));
      save();
      render();
      var again = document.getElementById('notes-newname');
      if (again) again.focus();
    });

    root.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act], [data-reset]');
      if (!btn) return;

      if (btn.dataset.reset) {
        doReset(btn.dataset.reset);
        return;
      }

      var hit = playerAt(btn);
      if (!hit) return;
      var p = hit.p, i = hit.i;

      switch (btn.dataset.act) {
        case 'up':
          if (i > 0) { state.players.splice(i - 1, 0, state.players.splice(i, 1)[0]); }
          break;
        case 'down':
          if (i < state.players.length - 1) { state.players.splice(i + 1, 0, state.players.splice(i, 1)[0]); }
          break;
        case 'remove':
          if (!p.name || confirm('„' + (p.name || 'Spieler') + '" wirklich entfernen?')) {
            state.players.splice(i, 1);
          } else return;
          break;
        case 'align':  p.align = btn.dataset.val; break;
        case 'alive':  p.alive = true; p.ghostVoteUsed = false; break;
        case 'dead':   p.alive = false; break;
        case 'ghost':  p.ghostVoteUsed = !p.ghostVoteUsed; break;
        case 'pick-claim': save(); openPicker(p.id, 'claim'); return;
        case 'pick-guess': save(); openPicker(p.id, 'guess'); return;
        default: return;
      }
      save();
      render();
    });

    /* Rollenwähler (liegt außerhalb von #notes-root) */
    document.addEventListener('click', function (ev) {
      var over = ev.target.closest('#role-picker');
      if (!over) return;

      if (ev.target.closest('[data-close]') || ev.target.classList.contains('sheetover')) {
        closePicker();
        return;
      }
      var btn = ev.target.closest('.pick--role');
      if (!btn || !picker) return;

      var p = state.players.filter(function (x) { return x.id === picker.playerId; })[0];
      if (!p) return;
      var role = btn.dataset.role;

      if (picker.mode === 'claim') {
        var idx = p.claims.indexOf(role);
        if (idx === -1) { p.claims.push(role); btn.dataset.state = 'on'; }
        else { p.claims.splice(idx, 1); btn.dataset.state = ''; }
      } else {
        var cur = p.guesses[role];
        if (!cur) { p.guesses[role] = 'suspect'; btn.dataset.state = 'suspect'; }
        else if (cur === 'suspect') { p.guesses[role] = 'ruled'; btn.dataset.state = 'ruled'; }
        else { delete p.guesses[role]; btn.dataset.state = ''; }
      }
      save();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && picker) closePicker();
    });
  }

  /* Nur die Nachbar-Zeilen auffrischen, ohne die Eingabefelder neu zu bauen */
  function refreshNeighbourLabels() {
    var cards = document.querySelectorAll('#notes-root .pcard');
    cards.forEach(function (card, i) {
      var line = card.querySelector('.pcard__neighbours');
      if (!line) return;
      var nb = aliveNeighbours(i);
      if (!nb) return;
      var nameOf = function (pl) {
        return pl ? (pl.name || 'Platz ' + (state.players.indexOf(pl) + 1)) : '—';
      };
      line.innerHTML = 'Lebende Nachbarn: <strong>' + esc(nameOf(nb.left)) +
                       '</strong> · <strong>' + esc(nameOf(nb.right)) + '</strong>';
    });
  }

  function doReset(kind) {
    if (kind === 'all') {
      if (!confirm('Alle Spieler und Notizen löschen?')) return;
      state = { script: state.script, players: [] };
    } else {
      if (!confirm('Neue Runde starten? Namen und Sitzordnung bleiben, alles andere wird zurückgesetzt.')) return;
      state.players = state.players.map(function (p) {
        return {
          id: p.id, name: p.name, alive: true, ghostVoteUsed: false,
          align: 'unknown', claims: [], guesses: {}, note: ''
        };
      });
    }
    save();
    render();
  }

  BOTC.notes = { init: init };

})(window.BOTC);
