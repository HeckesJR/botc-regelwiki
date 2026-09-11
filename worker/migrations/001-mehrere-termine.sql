-- ============================================================
-- Mehrere feststehende Termine je Abfrage
--
-- Vorher hielt polls.entschieden_option genau EINEN Termin. Manchmal
-- spielt die Runde aber an zwei Abenden — deshalb hängt die Festlegung
-- jetzt als Schalter am einzelnen Terminvorschlag.
--
-- polls.entschieden_option bleibt bestehen und wird weiter auf den
-- FRÜHESTEN festgelegten Termin gesetzt. Das kostet nichts und hält eine
-- noch im Speicher hängende Seitenfassung am Leben, die die Spalte liest.
--
-- Anwenden:
--   npx.cmd wrangler d1 execute botc-termine --local  --file=migrations/001-mehrere-termine.sql
--   npx.cmd wrangler d1 execute botc-termine --remote --file=migrations/001-mehrere-termine.sql
--
-- Gefahrlos: ADD COLUMN mit Vorgabewert, kein Datenverlust.
-- ============================================================

ALTER TABLE poll_options ADD COLUMN festgelegt INTEGER NOT NULL DEFAULT 0;

-- Bereits entschiedene Abfragen übernehmen
UPDATE poll_options
   SET festgelegt = 1
 WHERE id IN (SELECT entschieden_option FROM polls WHERE entschieden_option IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_options_fest ON poll_options(poll_id, festgelegt);
