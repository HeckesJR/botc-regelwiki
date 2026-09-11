/* ============================================================
   botc-termine — Cloudflare Worker für die Terminplanung

   Das Regelwiki selbst bleibt statisch auf GitHub Pages. Nur die
   Umfragedaten laufen hier durch, weil geteilte Daten einen Ort
   brauchen, an den geschrieben werden kann.

   Zugang über ein gemeinsames Gruppenwort im Kopf-Feld
   X-Gruppenwort. Das gilt auch fürs Lesen — sonst könnte jeder mit
   dem Link sehen, wer wann kann.
   ============================================================ */

const ROLLEN   = ['spielleiter', 'spieler', 'spieler_notfalls'];
const ANTWORTEN = ['ja', 'vielleicht', 'nein'];

const MAX_OPTIONEN   = 8;
const MAX_NAME       = 40;
const MAX_TITEL      = 80;
const MAX_NOTIZ      = 500;
const MAX_LABEL      = 60;

/* Sperre nach zu vielen falschen Gruppenwörtern */
const MAX_FEHLVERSUCHE = 10;
const SPERRE_MS        = 15 * 60 * 1000;

/* ---------------------------------------------- Hilfen */

/* Ohne 0/O/1/I/l — damit man eine ID auch vorlesen kann */
const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

function neueId(laenge = 8) {
  const bytes = crypto.getRandomValues(new Uint8Array(laenge));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

function jetzt() { return Date.now(); }

function text(v, max) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  /* Beim Entwickeln läuft die Seite auf localhost, sonst auf GitHub Pages. */
  const erlaubt = [env.ALLOWED_ORIGIN, 'http://localhost:8231', 'http://127.0.0.1:8231'];
  const treffer = erlaubt.indexOf(origin) !== -1 ? origin : env.ALLOWED_ORIGIN;
  return {
    'Access-Control-Allow-Origin': treffer,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Gruppenwort',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function json(data, request, env, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...corsHeaders(request, env)
    }
  });
}

function fehler(nachricht, request, env, status = 400) {
  return json({ fehler: nachricht }, request, env, status);
}

/* Vergleich ohne Zeitunterschied — verrät nicht, wie viele Zeichen stimmen. */
function gleich(a, b) {
  const x = new TextEncoder().encode(String(a));
  const y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/* ---------------------------------------------- Gruppenwort */

async function pruefeZugang(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unbekannt';

  const sperre = await env.DB
    .prepare('SELECT anzahl, bis FROM fehlversuche WHERE kennung = ?')
    .bind(ip).first();

  if (sperre && sperre.bis > jetzt()) {
    const minuten = Math.ceil((sperre.bis - jetzt()) / 60000);
    return { ok: false, status: 429,
             nachricht: `Zu viele Fehlversuche. Bitte in ${minuten} Minuten nochmal.` };
  }

  const wort = request.headers.get('X-Gruppenwort') || '';
  if (env.GRUPPENWORT && gleich(wort, env.GRUPPENWORT)) {
    if (sperre) await env.DB.prepare('DELETE FROM fehlversuche WHERE kennung = ?').bind(ip).run();
    return { ok: true };
  }

  const anzahl = (sperre ? sperre.anzahl : 0) + 1;
  const bis = anzahl >= MAX_FEHLVERSUCHE ? jetzt() + SPERRE_MS : 0;
  await env.DB.prepare(
    'INSERT INTO fehlversuche (kennung, anzahl, bis) VALUES (?, ?, ?) ' +
    'ON CONFLICT(kennung) DO UPDATE SET anzahl = ?, bis = ?'
  ).bind(ip, anzahl, bis, anzahl, bis).run();

  return { ok: false, status: 401, nachricht: 'Gruppenwort stimmt nicht.' };
}

/* ---------------------------------------------- Lesen */

async function ladePoll(env, id) {
  const poll = await env.DB.prepare('SELECT * FROM polls WHERE id = ?').bind(id).first();
  if (!poll) return null;

  const [optionen, teilnehmer, stimmen] = await Promise.all([
    env.DB.prepare('SELECT * FROM poll_options WHERE poll_id = ? ORDER BY sortierung, beginnt_am')
      .bind(id).all(),
    env.DB.prepare('SELECT voter_id, name, rolle FROM participants WHERE poll_id = ? ORDER BY geaendert')
      .bind(id).all(),
    env.DB.prepare('SELECT option_id, voter_id, antwort FROM votes WHERE poll_id = ?')
      .bind(id).all()
  ]);

  return {
    ...poll,
    optionen:   optionen.results   || [],
    teilnehmer: teilnehmer.results || [],
    stimmen:    stimmen.results    || []
  };
}

/* ---------------------------------------------- Routen */

async function postPolls(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return fehler('Kein gültiger Inhalt.', request, env);

  const titel = text(body.titel, MAX_TITEL);
  const von   = text(body.erstellt_von, MAX_NAME);
  if (!titel) return fehler('Die Abfrage braucht einen Titel.', request, env);
  if (!von)   return fehler('Bitte deinen Namen angeben.', request, env);

  const roh = Array.isArray(body.optionen) ? body.optionen : [];
  const optionen = roh
    .map(o => ({
      beginnt_am: text(typeof o === 'string' ? o : o.beginnt_am, 20),
      label:      text(typeof o === 'string' ? '' : o.label, MAX_LABEL)
    }))
    .filter(o => /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(o.beginnt_am))
    .slice(0, MAX_OPTIONEN);

  if (!optionen.length) return fehler('Mindestens ein Terminvorschlag nötig.', request, env);

  const id = neueId();
  const frist = /^\d{4}-\d{2}-\d{2}$/.test(text(body.frist, 10)) ? text(body.frist, 10) : null;

  const anweisungen = [
    env.DB.prepare(
      'INSERT INTO polls (id, titel, erstellt_von, erstellt_am, frist, status, notiz) ' +
      "VALUES (?, ?, ?, ?, ?, 'offen', ?)"
    ).bind(id, titel, von, jetzt(), frist, text(body.notiz, MAX_NOTIZ))
  ];

  optionen.forEach((o, i) => {
    anweisungen.push(env.DB.prepare(
      'INSERT INTO poll_options (id, poll_id, beginnt_am, label, sortierung) VALUES (?, ?, ?, ?, ?)'
    ).bind(neueId(6), id, o.beginnt_am, o.label, i));
  });

  await env.DB.batch(anweisungen);
  return json(await ladePoll(env, id), request, env, 201);
}

async function postVote(request, env, id) {
  const poll = await env.DB.prepare('SELECT status FROM polls WHERE id = ?').bind(id).first();
  if (!poll) return fehler('Abfrage gibt es nicht.', request, env, 404);
  if (poll.status === 'abgesagt') return fehler('Diese Abfrage ist abgesagt.', request, env, 409);

  const body = await request.json().catch(() => null);
  if (!body) return fehler('Kein gültiger Inhalt.', request, env);

  const voterId = text(body.voter_id, 40);
  const name    = text(body.name, MAX_NAME);
  const rolle   = ROLLEN.indexOf(body.rolle) !== -1 ? body.rolle : 'spieler';
  if (!voterId) return fehler('Fehlende Teilnehmerkennung.', request, env);
  if (!name)    return fehler('Bitte einen Namen angeben.', request, env);

  /* Nur Antworten auf Termine, die es in dieser Abfrage wirklich gibt */
  const gueltig = await env.DB.prepare('SELECT id FROM poll_options WHERE poll_id = ?')
    .bind(id).all();
  const erlaubteIds = new Set((gueltig.results || []).map(o => o.id));

  const antworten = (body.antworten && typeof body.antworten === 'object') ? body.antworten : {};

  const anweisungen = [
    env.DB.prepare(
      'INSERT INTO participants (poll_id, voter_id, name, rolle, geaendert) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(poll_id, voter_id) DO UPDATE SET name = ?, rolle = ?, geaendert = ?'
    ).bind(id, voterId, name, rolle, jetzt(), name, rolle, jetzt())
  ];

  for (const [optionId, antwort] of Object.entries(antworten)) {
    if (!erlaubteIds.has(optionId)) continue;
    if (ANTWORTEN.indexOf(antwort) === -1) continue;
    anweisungen.push(env.DB.prepare(
      'INSERT INTO votes (poll_id, option_id, voter_id, antwort) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(option_id, voter_id) DO UPDATE SET antwort = ?'
    ).bind(id, optionId, voterId, antwort, antwort));
  }

  await env.DB.batch(anweisungen);
  return json(await ladePoll(env, id), request, env);
}

async function postDecide(request, env, id) {
  const body = await request.json().catch(() => null);
  const optionId = text(body && body.option_id, 40);

  const option = await env.DB
    .prepare('SELECT id FROM poll_options WHERE id = ? AND poll_id = ?')
    .bind(optionId, id).first();
  if (!option) return fehler('Diesen Terminvorschlag gibt es hier nicht.', request, env, 404);

  await env.DB.prepare("UPDATE polls SET status = 'entschieden', entschieden_option = ? WHERE id = ?")
    .bind(optionId, id).run();

  return json(await ladePoll(env, id), request, env);
}

async function postCancel(request, env, id) {
  const body = await request.json().catch(() => ({}));
  const grund = text(body && body.grund, MAX_NOTIZ);

  const treffer = await env.DB
    .prepare("UPDATE polls SET status = 'abgesagt', notiz = ? WHERE id = ?")
    .bind(grund, id).run();

  if (!treffer.meta || treffer.meta.changes === 0) {
    return fehler('Abfrage gibt es nicht.', request, env, 404);
  }
  return json(await ladePoll(env, id), request, env);
}

/* Für das Banner auf der Startseite: die neueste offene Abfrage und der
   nächste feststehende Termin. Bewusst eine einzige schlanke Antwort,
   damit die Startseite nicht drei Anfragen braucht. */
async function getCurrent(request, env) {
  const offen = await env.DB.prepare(
    "SELECT id, titel, frist FROM polls WHERE status = 'offen' ORDER BY erstellt_am DESC LIMIT 1"
  ).first();

  let umfrage = null;
  if (offen) {
    const [optionen, teilnehmer] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) AS n FROM poll_options WHERE poll_id = ?').bind(offen.id).first(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM participants WHERE poll_id = ?').bind(offen.id).first()
    ]);
    umfrage = {
      id: offen.id, titel: offen.titel, frist: offen.frist,
      anzahl_optionen: optionen.n, anzahl_teilnehmer: teilnehmer.n
    };
  }

  const heute = new Date().toISOString().slice(0, 10);
  const fest = await env.DB.prepare(
    "SELECT p.id, p.titel, o.beginnt_am, o.label FROM polls p " +
    'JOIN poll_options o ON o.id = p.entschieden_option ' +
    "WHERE p.status = 'entschieden' AND substr(o.beginnt_am, 1, 10) >= ? " +
    'ORDER BY o.beginnt_am LIMIT 1'
  ).bind(heute).first();

  let zusagen = 0;
  if (fest) {
    const z = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM votes v JOIN polls p ON p.id = v.poll_id " +
      "WHERE v.poll_id = ? AND v.option_id = p.entschieden_option AND v.antwort = 'ja'"
    ).bind(fest.id).first();
    zusagen = z ? z.n : 0;
  }

  return json({ umfrage, termin: fest ? { ...fest, zusagen } : null }, request, env);
}

async function getPolls(request, env) {
  const liste = await env.DB.prepare(
    'SELECT id, titel, erstellt_von, erstellt_am, status, entschieden_option ' +
    'FROM polls ORDER BY erstellt_am DESC LIMIT 30'
  ).all();
  return json({ polls: liste.results || [] }, request, env);
}

/* ---------------------------------------------- Einstieg */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pfad = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (!pfad.startsWith('/api/')) {
      return fehler('Hier gibt es nichts. Die Seite liegt woanders.', request, env, 404);
    }

    if (!env.GRUPPENWORT) {
      return fehler('Auf dem Server ist kein Gruppenwort hinterlegt.', request, env, 500);
    }

    const zugang = await pruefeZugang(request, env);
    if (!zugang.ok) return fehler(zugang.nachricht, request, env, zugang.status);

    try {
      /* Nur zum Prüfen des Gruppenworts in der Eingabemaske */
      if (pfad === '/api/check') return json({ ok: true }, request, env);

      if (pfad === '/api/current' && request.method === 'GET') return getCurrent(request, env);
      if (pfad === '/api/polls'   && request.method === 'GET') return getPolls(request, env);
      if (pfad === '/api/polls'   && request.method === 'POST') return postPolls(request, env);

      const m = pfad.match(/^\/api\/polls\/([a-z0-9]{4,12})(\/(vote|decide|cancel))?$/);
      if (m) {
        const id = m[1], aktion = m[3];
        if (!aktion && request.method === 'GET') {
          const poll = await ladePoll(env, id);
          return poll ? json(poll, request, env)
                      : fehler('Abfrage gibt es nicht.', request, env, 404);
        }
        if (request.method === 'POST') {
          if (aktion === 'vote')   return postVote(request, env, id);
          if (aktion === 'decide') return postDecide(request, env, id);
          if (aktion === 'cancel') return postCancel(request, env, id);
        }
      }

      return fehler('Unbekannter Weg.', request, env, 404);

    } catch (e) {
      console.error(e);
      return fehler('Da ist auf dem Server etwas schiefgegangen.', request, env, 500);
    }
  }
};
