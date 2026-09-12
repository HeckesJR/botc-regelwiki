-- ============================================================
-- Drei Zustände je Terminvorschlag statt eines Schalters
--
--   vorschlag   steht zur Abstimmung
--   vorgemerkt  soll stattfinden; die Abstimmung über die übrigen
--               Vorschläge ist damit zu
--   final       steht fest; keine neuen Zusagen mehr, nur noch absagen
--
-- poll_options.festgelegt bleibt und wird weiter gepflegt (1 für
-- vorgemerkt UND final). Die Spalte kostet nichts und hält eine noch im
-- Speicher hängende Seitenfassung am Leben.
--
-- Anwenden:
--   npx.cmd wrangler d1 execute botc-termine --local  --file=migrations/002-vormerken-und-final.sql
--   npx.cmd wrangler d1 execute botc-termine --remote --file=migrations/002-vormerken-und-final.sql
--
-- Gefahrlos: ADD COLUMN mit Vorgabewert, kein Datenverlust.
-- ============================================================

ALTER TABLE poll_options ADD COLUMN zustand TEXT NOT NULL DEFAULT 'vorschlag';

-- Was bisher festgelegt war, ist ab jetzt vorgemerkt. Final gab es noch nicht.
UPDATE poll_options SET zustand = 'vorgemerkt' WHERE festgelegt = 1;

CREATE INDEX IF NOT EXISTS idx_options_zustand ON poll_options(poll_id, zustand);
