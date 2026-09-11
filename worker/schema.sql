-- ============================================================
-- Tabellen für die Terminplanung
--
-- Anlegen:
--   npx wrangler d1 execute botc-termine --local  --file=schema.sql   (zum Testen)
--   npx wrangler d1 execute botc-termine --remote --file=schema.sql   (echt)
-- ============================================================

-- Eine Terminabfrage.
CREATE TABLE IF NOT EXISTS polls (
  id                 TEXT PRIMARY KEY,
  titel              TEXT    NOT NULL,
  erstellt_von       TEXT    NOT NULL,
  erstellt_am        INTEGER NOT NULL,          -- Unix-Zeit in Millisekunden
  frist              TEXT,                      -- ISO-Datum, optional
  status             TEXT    NOT NULL DEFAULT 'offen',   -- offen | entschieden | abgesagt
  entschieden_option TEXT,                      -- welcher Terminvorschlag es geworden ist
  notiz              TEXT    NOT NULL DEFAULT ''
);

-- Die einzelnen Terminvorschläge einer Abfrage.
CREATE TABLE IF NOT EXISTS poll_options (
  id         TEXT PRIMARY KEY,
  poll_id    TEXT    NOT NULL REFERENCES polls(id),
  beginnt_am TEXT    NOT NULL,                  -- "2026-10-17" oder "2026-10-17T19:00"
  label      TEXT    NOT NULL DEFAULT '',       -- optional, z. B. "bei Jan"
  sortierung INTEGER NOT NULL DEFAULT 0
);

-- Wer mitmacht und in welcher Rolle. Die Rolle hängt am Teilnehmer, nicht am
-- Termin — wer leiten will, will das an jedem Abend.
CREATE TABLE IF NOT EXISTS participants (
  poll_id   TEXT    NOT NULL REFERENCES polls(id),
  voter_id  TEXT    NOT NULL,                   -- Zufalls-ID aus dem localStorage
  name      TEXT    NOT NULL,
  rolle     TEXT    NOT NULL DEFAULT 'spieler', -- spielleiter | spieler | spieler_notfalls
  geaendert INTEGER NOT NULL,
  PRIMARY KEY (poll_id, voter_id)
);

-- Eine Antwort pro Person und Terminvorschlag.
CREATE TABLE IF NOT EXISTS votes (
  poll_id   TEXT NOT NULL REFERENCES polls(id),
  option_id TEXT NOT NULL REFERENCES poll_options(id),
  voter_id  TEXT NOT NULL,
  antwort   TEXT NOT NULL,                      -- ja | vielleicht | nein
  PRIMARY KEY (option_id, voter_id)
);

-- Bremse gegen das Durchprobieren des Gruppenworts.
CREATE TABLE IF NOT EXISTS fehlversuche (
  kennung TEXT    PRIMARY KEY,                  -- IP-Adresse
  anzahl  INTEGER NOT NULL,
  bis     INTEGER NOT NULL                      -- gesperrt bis (Unix-Zeit ms)
);

CREATE INDEX IF NOT EXISTS idx_options_poll  ON poll_options(poll_id, sortierung);
CREATE INDEX IF NOT EXISTS idx_parts_poll    ON participants(poll_id);
CREATE INDEX IF NOT EXISTS idx_votes_poll    ON votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_polls_aktuell ON polls(status, erstellt_am DESC);
