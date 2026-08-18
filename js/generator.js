/* ============================================================
   generator.js — Grundverteilung, Bluffs, Balance-Bewertung,
   Setup-Vorschläge und Zufallsrunden
   ============================================================ */

window.BOTC = window.BOTC || {};

(function (BOTC) {
  'use strict';

  /* Offizielle Grundverteilung, editionsunabhängig.
     Index = Spieleranzahl. Ab 16 Spielern gilt die 15er-Zeile,
     jeder Spieler darüber ist ein Reisender. */
  var DISTRIBUTION = {
    5:  { townsfolk: 3, outsider: 0, minion: 1, demon: 1 },
    6:  { townsfolk: 3, outsider: 1, minion: 1, demon: 1 },
    7:  { townsfolk: 5, outsider: 0, minion: 1, demon: 1 },
    8:  { townsfolk: 5, outsider: 1, minion: 1, demon: 1 },
    9:  { townsfolk: 5, outsider: 2, minion: 1, demon: 1 },
    10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1 },
    11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1 },
    12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1 },
    13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1 },
    14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1 },
    15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1 }
  };

  var MIN_PLAYERS = 5;
  var MAX_PLAYERS = 20;
  var BLUFF_COUNT = 3;

  /* Wird von app.js nach dem Laden gesetzt. */
  var balance = { tags: {}, weights: {}, tag_labels: {} };
  function setBalance(doc) { if (doc) balance = doc; }
  function tagsOf(ch) { return (ch && balance.tags[ch.id]) || []; }
  function has(ch, tag) { return tagsOf(ch).indexOf(tag) !== -1; }
  function w(key, fallback) {
    var v = balance.weights && balance.weights[key];
    return typeof v === 'number' ? v : (fallback || 0);
  }

  /* ---------------------------------------------- Verteilung */

  function baseDistribution(players) {
    var n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players | 0));
    var base = DISTRIBUTION[Math.min(n, 15)];
    return {
      townsfolk: base.townsfolk,
      outsider: base.outsider,
      minion: base.minion,
      demon: base.demon,
      travellers: Math.max(0, n - 15)
    };
  }

  /**
   * Wendet Setup-Modifikatoren an (Baron +2, Fang Gu +1, Vigormortis −1, Pate ±1).
   * Bürger werden gegen Außenseiter getauscht, die Gesamtzahl bleibt gleich.
   */
  function applyModifiers(dist, characters, pool) {
    var result = {
      townsfolk: dist.townsfolk, outsider: dist.outsider,
      minion: dist.minion, demon: dist.demon, travellers: dist.travellers
    };
    var notes = [];
    var maxOutsiders = (pool || []).filter(function (c) { return c.type === 'outsider'; }).length;

    characters.forEach(function (ch) {
      var mod = ch.setup_modifier;
      if (!mod) return;

      var delta = mod.outsider_choice
        ? ((result.outsider < maxOutsiders && result.townsfolk > 1) ? 1 : -1)
        : mod.outsider;

      var clamped = Math.max(0, Math.min(maxOutsiders, result.outsider + delta));
      if (result.townsfolk - (clamped - result.outsider) < 1) {
        clamped = result.outsider + (result.townsfolk - 1);
      }
      var actual = clamped - result.outsider;
      if (actual === 0) return;

      result.outsider += actual;
      result.townsfolk -= actual;
      notes.push(ch.name_de + ': ' + (actual > 0 ? '+' : '−') + Math.abs(actual) +
                 ' Außenseiter (dafür ' + Math.abs(actual) + ' Bürger weniger)');
    });

    return { dist: result, notes: notes };
  }

  function countByType(list) {
    var c = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
    list.forEach(function (ch) { if (c[ch.type] != null) c[ch.type]++; });
    return c;
  }

  function shuffle(arr, rng) {
    var random = rng || Math.random;
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ---------------------------------------------- Bluffs */

  /**
   * Die 3 nicht im Spiel befindlichen GUTEN Charaktere, die der Dämon
   * in der ersten Nacht gezeigt bekommt.
   */
  function pickBluffs(pool, chosen, rng, count) {
    var used = {};
    (chosen || []).forEach(function (ch) { used[ch.id] = true; });

    var candidates = (pool || []).filter(function (ch) {
      return !used[ch.id] && (ch.type === 'townsfolk' || ch.type === 'outsider');
    });

    /* Bürger sind die glaubwürdigeren Bluffs — sie kommen zuerst,
       Außenseiter füllen nur auf, wenn nötig. */
    var townsfolk = shuffle(candidates.filter(function (c) { return c.type === 'townsfolk'; }), rng);
    var outsiders = shuffle(candidates.filter(function (c) { return c.type === 'outsider'; }), rng);

    return townsfolk.concat(outsiders).slice(0, count || BLUFF_COUNT);
  }

  /* ---------------------------------------------- Balance-Bewertung */

  /**
   * Bewertet eine Zusammenstellung heuristisch. Liefert eine Punktzahl
   * und eine Begründung in Klartext — beides landet in der Oberfläche.
   */
  function scoreSetup(chars) {
    var good = chars.filter(function (c) { return c.type === 'townsfolk'; });
    var outs = chars.filter(function (c) { return c.type === 'outsider'; });
    var evil = chars.filter(function (c) { return c.type === 'minion' || c.type === 'demon'; });

    var n = good.length || 1;
    var ongoing  = good.filter(function (c) { return has(c, 'info-ongoing'); }).length;
    var starting = good.filter(function (c) { return has(c, 'info-start'); }).length;
    var protect  = good.filter(function (c) { return has(c, 'protect'); }).length;
    var passive  = good.filter(function (c) { return has(c, 'passive'); }).length;
    var social   = good.filter(function (c) { return has(c, 'social'); }).length;
    var fragile  = good.filter(function (c) { return has(c, 'fragile'); }).length;
    var infoTotal = ongoing + starting;

    var killers  = evil.filter(function (c) { return has(c, 'kill'); }).length;
    var evilDisrupt = evil.filter(function (c) { return has(c, 'disrupt'); }).length;
    var selfharm = outs.filter(function (c) { return has(c, 'selfharm'); }).length;

    var score = 50;
    var plus = [], minus = [];

    /* --- Bekommt Gut überhaupt fortlaufend Informationen? --- */
    if (ongoing === 0) {
      score += w('keine_laufende_info', -30);
      minus.push('Kein Bürger liefert nach der ersten Nacht noch Informationen — das gute Team fliegt blind.');
    } else if (ongoing >= 2) {
      score += w('viel_info', 6);
      plus.push(ongoing + ' Bürger liefern fortlaufend Informationen.');
    }

    if (infoTotal < Math.max(2, Math.round(n * 0.4))) {
      score += w('kaum_info', -18);
      minus.push('Insgesamt sehr wenig Information für das gute Team.');
    } else if (infoTotal >= Math.round(n * 0.7)) {
      score += w('viel_info', 6);
      plus.push('Das gute Team ist informationsstark.');
    }

    /* --- Schutz gegen die Todesquellen --- */
    if (protect === 0 && killers >= 2) {
      score += w('kein_schutz_gegen_toeter', -22);
      minus.push('Mehrere böse Charaktere töten, aber es gibt keinerlei Schutz.');
    } else if (protect === 0) {
      score += w('kein_schutz', -8);
      minus.push('Kein Bürger kann Tode verhindern.');
    } else {
      score += w('schutz_vorhanden', 8);
      plus.push('Es gibt Schutz gegen die nächtlichen Tode.');
    }

    /* --- Zu viel Leerlauf? --- */
    if (passive > Math.ceil(n / 2)) {
      score += w('zu_viel_passiv', -14);
      minus.push('Sehr viele Bürger haben nichts zu entscheiden.');
    }
    if (fragile >= 2) {
      score += w('zu_viel_einmalig', -8);
      minus.push('Mehrere Bürger erfahren erst beim eigenen Tod etwas.');
    }

    /* --- Hat Böse Werkzeuge, um Information zu verfälschen? --- */
    if (evilDisrupt === 0) {
      score += w('keine_stoerung', -12);
      minus.push('Böse kann die Informationen des guten Teams nicht verfälschen.');
    } else if (evilDisrupt >= 1 && ongoing >= 1) {
      score += w('gute_stoerbalance', 8);
      plus.push('Böse kann Informationen gezielt verfälschen — das hält die Spannung.');
    }

    if (selfharm >= 3) {
      score += w('zu_viel_selfharm', -10);
      minus.push('Ungewöhnlich viele Außenseiter arbeiten gegen das eigene Team.');
    }

    if (social >= 1) {
      score += w('tagfaehigkeit_vorhanden', 5);
      plus.push('Mindestens eine Fähigkeit wird am Tag öffentlich ausgelöst — das erzeugt große Momente.');
    }

    /* --- Abwechslung: wie viele verschiedene Tags kommen vor? --- */
    var seen = {};
    chars.forEach(function (c) { tagsOf(c).forEach(function (t) { seen[t] = true; }); });
    var variety = Object.keys(seen).length;
    score += Math.min(w('vielfalt', 10), variety);
    if (variety >= 8) plus.push('Die Zusammenstellung deckt viele verschiedene Spielmechaniken ab.');

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      plus: plus,
      minus: minus,
      stats: {
        infoOngoing: ongoing, infoStart: starting, protect: protect,
        passive: passive, killers: killers, evilDisrupt: evilDisrupt
      }
    };
  }

  /* Baut aus der Bewertung einen lesbaren Begründungstext. */
  function reasonFromScore(sc) {
    var parts = [];
    if (sc.plus.length) parts.push(sc.plus.join(' '));
    if (sc.minus.length) parts.push('**Achte darauf:** ' + sc.minus.join(' '));
    if (!parts.length) parts.push('Eine unauffällige, ausgewogene Zusammenstellung.');
    return parts.join(' ');
  }

  /* ---------------------------------------------- Ziehen */

  function drawSet(pool, targetDist, rng) {
    var picked = [], used = {};

    function draw(type, count) {
      var avail = pool.filter(function (ch) { return ch.type === type && !used[ch.id]; });
      shuffle(avail, rng);
      avail.slice(0, Math.max(0, count)).forEach(function (ch) {
        used[ch.id] = true; picked.push(ch);
      });
    }

    /* Dämon und Schergen zuerst — sie können die Verteilung verändern. */
    draw('demon', targetDist.demon);
    draw('minion', targetDist.minion);

    var mods = applyModifiers(targetDist, picked, pool);
    draw('outsider', mods.dist.outsider);
    draw('townsfolk', mods.dist.townsfolk);

    var counts = countByType(picked);
    var missing = [];
    ['townsfolk', 'outsider', 'minion', 'demon'].forEach(function (t) {
      var gap = mods.dist[t] - counts[t];
      if (gap > 0) missing.push(gap + '× ' + (BOTC.TYPE_LABEL[t] || t));
    });

    return { characters: picked, dist: mods.dist, notes: mods.notes, missing: missing };
  }

  /**
   * Zieht viele Kandidaten und behält die bestbewerteten.
   * Genau das ist der Unterschied zwischen „zufällig" und „ausgewogen".
   */
  function balancedDraw(pool, targetDist, opts) {
    opts = opts || {};
    var attempts = opts.attempts || 250;
    var wanted = opts.count || 1;
    var rng = opts.rng;
    var seen = {}, results = [];

    for (var i = 0; i < attempts; i++) {
      var d = drawSet(pool, targetDist, rng);
      if (d.missing.length) continue;

      /* Gleiche Zusammenstellungen nicht doppelt vorschlagen */
      var key = d.characters.map(function (c) { return c.id; }).sort().join('|');
      if (seen[key]) continue;
      seen[key] = true;

      d.score = scoreSetup(d.characters);
      results.push(d);
    }

    results.sort(function (a, b) { return b.score.score - a.score.score; });
    return results.slice(0, wanted);
  }

  /* ---------------------------------------------- Kuratierte Setups skalieren */

  function scaleSetup(setup, pool, targetDist, rng) {
    var map = {};
    pool.forEach(function (ch) { map[ch.id] = ch; });

    var chosen = [], used = {};
    var quota = {
      townsfolk: targetDist.townsfolk, outsider: targetDist.outsider,
      minion: targetDist.minion, demon: targetDist.demon
    };

    ['demon', 'minion', 'outsider', 'townsfolk'].forEach(function (type) {
      setup.characters.forEach(function (id) {
        var ch = map[id];
        if (!ch || ch.type !== type || used[id] || quota[type] <= 0) return;
        chosen.push(ch); used[id] = true; quota[type]--;
      });
    });

    var missing = [];
    ['townsfolk', 'outsider', 'minion', 'demon'].forEach(function (type) {
      var avail = pool.filter(function (ch) { return ch.type === type && !used[ch.id]; });
      shuffle(avail, rng);
      while (quota[type] > 0 && avail.length) {
        var ch = avail.shift();
        chosen.push(ch); used[ch.id] = true; quota[type]--;
      }
      if (quota[type] > 0) missing.push(quota[type] + '× ' + (BOTC.TYPE_LABEL[type] || type));
    });

    return { characters: BOTC.sortCharacters(chosen), missing: missing };
  }

  /* ---------------------------------------------- Öffentliche API */

  /* Ein „Skript" ist entweder eine Edition oder eine eigene Zusammenstellung.
     Beide haben ein characters-Array — mehr braucht der Generator nicht. */
  function poolOf(script) {
    return (script && script.characters || []).filter(function (ch) {
      return ch.type === 'townsfolk' || ch.type === 'outsider' ||
             ch.type === 'minion' || ch.type === 'demon';
    });
  }

  function finish(entry, pool, players, rng) {
    entry.characters = BOTC.sortCharacters(entry.characters);
    entry.counts = countByType(entry.characters);
    entry.bluffs = pickBluffs(pool, entry.characters, rng);
    if (!entry.score) entry.score = scoreSetup(entry.characters);
    return entry;
  }

  /**
   * 1–3 Vorschläge für die gewünschte Spieleranzahl.
   * Kuratierte Vorlagen zuerst, danach mit ausgewogenen Zufallsrunden aufgefüllt.
   */
  function suggestSetups(script, players, options) {
    options = options || {};
    var rng = options.rng;
    var n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players | 0));
    var base = baseDistribution(n);
    var pool = poolOf(script);
    var map = {};
    pool.forEach(function (ch) { map[ch.id] = ch; });

    var setups = (script.setups || []).slice().sort(function (a, b) {
      var da = Math.abs((a.players || 8) - n), db = Math.abs((b.players || 8) - n);
      if (da !== db) return da - db;
      return (b.curated ? 1 : 0) - (a.curated ? 1 : 0);
    });

    var out = setups.slice(0, 3).map(function (setup) {
      var setupChars = (setup.characters || []).map(function (id) { return map[id]; }).filter(Boolean);
      var mods = applyModifiers(base, setupChars, pool);
      var exact = (setup.players === n);
      var chars, missing;

      if (exact) {
        chars = setupChars; missing = [];
      } else {
        var scaled = scaleSetup(setup, pool, mods.dist, rng);
        chars = scaled.characters; missing = scaled.missing;
        var re = applyModifiers(base, chars, pool);
        mods = re;
      }

      return finish({
        id: setup.id,
        name: setup.name,
        curated: !!setup.curated,
        exact: exact,
        originalPlayers: setup.players,
        difficulty: setup.difficulty || '',
        reason: setup.reason || '',
        characters: chars,
        distribution: mods.dist,
        modifierNotes: mods.notes,
        missing: missing
      }, pool, n, rng);
    });

    /* Zu wenige Vorlagen? Mit ausgewogenen Zufallsrunden auffüllen. */
    if (out.length < 3) {
      var extra = balancedDraw(pool, base, { count: 3 - out.length, rng: rng, attempts: options.attempts });
      extra.forEach(function (d, i) {
        out.push(finish({
          id: 'balanced-' + Date.now() + '-' + i,
          name: 'Ausgewogene Runde ' + (i + 1),
          curated: false,
          exact: true,
          balanced: true,
          difficulty: '',
          reason: reasonFromScore(d.score),
          characters: d.characters,
          distribution: d.dist,
          modifierNotes: d.notes,
          missing: d.missing,
          score: d.score
        }, pool, n, rng));
      });
    }

    return { players: n, base: base, travellers: base.travellers, suggestions: out };
  }

  /**
   * Ausgewogene Zufallsrunden: viele Kandidaten ziehen, die besten behalten.
   */
  function balancedSetups(script, players, options) {
    options = options || {};
    var n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players | 0));
    var base = baseDistribution(n);
    var pool = poolOf(script);
    var count = options.count || 3;

    var picks = balancedDraw(pool, base, {
      count: count, rng: options.rng, attempts: options.attempts || 300
    });

    if (!picks.length) {
      return { players: n, base: base, travellers: base.travellers, suggestions: [], error:
        'Aus diesem Skript lässt sich für ' + n + ' Spieler keine vollständige Runde bilden — es fehlen Charaktere eines Typs.' };
    }

    var suggestions = picks.map(function (d, i) {
      return finish({
        id: 'balanced-' + Date.now() + '-' + i,
        name: count > 1 ? 'Vorschlag ' + (i + 1) : 'Ausgewogene Runde',
        curated: false, exact: true, balanced: true, difficulty: '',
        reason: reasonFromScore(d.score),
        characters: d.characters,
        distribution: d.dist,
        modifierNotes: d.notes,
        missing: d.missing,
        score: d.score
      }, pool, n, options.rng);
    });

    return { players: n, base: base, travellers: base.travellers, suggestions: suggestions };
  }

  /** Reiner Zufall, ohne Bewertung — für den schnellen Spielabend. */
  function randomSetup(script, players, options) {
    options = options || {};
    var n = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, players | 0));
    var base = baseDistribution(n);
    var pool = poolOf(script);
    var d = drawSet(pool, base, options.rng);

    return {
      players: n, base: base, travellers: base.travellers,
      suggestions: [finish({
        id: 'random-' + Date.now(),
        name: 'Zufälliges Setup',
        curated: false, exact: true, difficulty: '',
        reason: 'Frei aus dem Charakterpool gezogen und an die Grundverteilung angepasst. ' +
                'Nicht auf Balance geprüft — wirf vor dem Spiel einen Blick darauf.',
        characters: d.characters,
        distribution: d.dist,
        modifierNotes: d.notes,
        missing: d.missing
      }, pool, n, options.rng)]
    };
  }

  BOTC.DISTRIBUTION = DISTRIBUTION;
  BOTC.MIN_PLAYERS = MIN_PLAYERS;
  BOTC.MAX_PLAYERS = MAX_PLAYERS;
  BOTC.setBalance = setBalance;
  BOTC.baseDistribution = baseDistribution;
  BOTC.applyModifiers = applyModifiers;
  BOTC.pickBluffs = pickBluffs;
  BOTC.scoreSetup = scoreSetup;
  BOTC.suggestSetups = suggestSetups;
  BOTC.balancedSetups = balancedSetups;
  BOTC.randomSetup = randomSetup;
  BOTC.characterTags = tagsOf;

})(window.BOTC);
