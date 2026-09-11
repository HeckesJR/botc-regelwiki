# botc-termine — der Dienst hinter der Terminplanung

Das Regelwiki ist eine statische Seite auf GitHub Pages. Statisch heißt: Sie kann
Dateien ausliefern, aber keine entgegennehmen. Für gemeinsame Umfragen braucht es
einen Ort, an den geschrieben werden kann — das ist dieser kleine Dienst.

Die Seite selbst bleibt, wo sie ist. **Die URL ändert sich nicht, niemand muss die
App neu auf den Homescreen legen.**

```
Handy ──── GitHub Pages ──►  Seite, Regeln, Icons     (unverändert)
   │
   └────── Cloudflare Worker ──►  Umfragen, Stimmen    (dieser Ordner)
                   └── D1 (SQLite)
```

---

## Einmalig einrichten

Du brauchst ein kostenloses Cloudflare-Konto. Alle Befehle **im Ordner `worker/`**,
und wie immer unter Windows PowerShell **einzeln** — `&&` funktioniert dort nicht.

> **`npx.cmd` statt `npx` unter Windows PowerShell.** Sonst kommt:
> *„Die Datei npx.ps1 kann nicht geladen werden, da die Ausführung von Skripts auf
> diesem System deaktiviert ist."*
> Windows PowerShell 5.1 steht standardmäßig auf `Restricted` und blockiert damit
> jedes `.ps1`-Skript. `.cmd`-Dateien sind davon nicht betroffen. In der klassischen
> Eingabeaufforderung (`cmd`) tritt das Problem gar nicht auf.

```
npx.cmd wrangler login
```

```
npx.cmd wrangler d1 create botc-termine
```

Der letzte Befehl gibt eine `database_id` aus. Die muss in `wrangler.toml` bei
`database_id = "HIER_EINTRAGEN"` eingesetzt werden.

Dann die Tabellen anlegen:

```
npx.cmd wrangler d1 execute botc-termine --remote --file=schema.sql
```

Das Gruppenwort setzen — es wird abgefragt und **nicht** in einer Datei gespeichert:

```
npx.cmd wrangler secret put GRUPPENWORT
```

Und hochladen:

```
npx.cmd wrangler deploy
```

Am Ende steht die Adresse des Dienstes da, etwa
`https://botc-termine.<dein-name>.workers.dev`. Die muss in `js/termine.js` als
`API` eingetragen werden.

> **Der Zugangsschlüssel liegt in `~/.wrangler`, nicht im Repo.** Es kann also nichts
> versehentlich öffentlich werden. Das Gruppenwort liegt verschlüsselt bei Cloudflare.

---

## Lokal testen, ohne Cloudflare-Konto

`wrangler dev --local` legt eine SQLite-Datei auf der Platte an und braucht kein Konto:

```
npx.cmd wrangler d1 execute botc-termine --local --file=schema.sql
```

```
npx.cmd wrangler dev --local --port 8787
```

Das Gruppenwort kommt dabei aus `.dev.vars` (per `.gitignore` ausgeschlossen):

```
GRUPPENWORT = "DEIN-WORT-HIER"
```

> **Nie ein echtes Gruppenwort in eine Datei schreiben, die im Repo landet.**
> Das Repo ist öffentlich. `.dev.vars` ist ausgeschlossen, `README.md` nicht.

---

## Später etwas ändern

Nur wenn sich **dieser Ordner** ändert:

```
npx.cmd wrangler deploy
```

Änderungen an der Seite selbst gehen weiterhin ganz normal über `git push`. Die
beiden Wege sind unabhängig voneinander.

---

## Die Schnittstelle

Alle Wege verlangen das Kopf-Feld `X-Gruppenwort`, auch die lesenden. Sonst könnte
jeder mit dem Link sehen, wer wann kann.

| Weg | Zweck |
|---|---|
| `GET /api/check` | Gruppenwort prüfen (für die Eingabemaske) |
| `GET /api/current` | alle laufenden Abfragen + alle anstehenden festen Termine (fürs Banner) |
| `GET /api/polls` | die letzten 30 Abfragen |
| `POST /api/polls` | Abfrage anlegen (höchstens 12 Terminvorschläge) |
| `GET /api/polls/:id` | eine Abfrage mit Terminen, Teilnehmern, Stimmen |
| `POST /api/polls/:id/vote` | eigene Rolle und Antworten speichern |
| `POST /api/polls/:id/decide` | Termin festlegen oder wieder lösen (`festgelegt`); mehrere je Abfrage erlaubt |
| `POST /api/polls/:id/cancel` | absagen |
| `POST /api/polls/:id/option` | Ort (`label`) und Uhrzeit (`zeit`, HH:MM) nachtragen — `/ort` bleibt als alter Name gültig |

CORS ist fest auf `https://heckesjr.github.io` gesetzt, nicht auf `*`. Beim
Entwickeln ist zusätzlich `http://localhost:8231` erlaubt.

### Schutz gegen Durchprobieren

Nach **10 falschen Gruppenwörtern von derselben IP** ist 15 Minuten Pause — auch für
das richtige Wort, sonst wäre die Sperre wirkungslos.

> Zu bedenken: Mobilfunk teilt IP-Adressen unter vielen Kunden. Theoretisch könnten
> sich mehrere aus der Runde gegenseitig aussperren. Bei zehn erlaubten Versuchen
> für ein Wort, das alle kennen, ist das unwahrscheinlich. Die Zahlen stehen oben in
> `src/index.js` als `MAX_FEHLVERSUCHE` und `SPERRE_MS`.

---

## Datenmodell

```
polls          id · titel · erstellt_von · erstellt_am · frist · status · entschieden_option · notiz
poll_options   id · poll_id · beginnt_am · label · sortierung · festgelegt
participants   poll_id · voter_id · name · rolle · geaendert
votes          poll_id · option_id · voter_id · antwort
fehlversuche   kennung · anzahl · bis
```

`rolle` ∈ `spielleiter | spieler | spieler_notfalls`
`antwort` ∈ `ja | vielleicht | nein`
`status` ∈ `offen | entschieden | abgesagt`

**Die Rolle hängt am Teilnehmer, nicht am Termin.** Wer leiten will, will das an
jedem Abend — das einzeln pro Termin abzufragen wäre nur lästig.

`voter_id` ist eine Zufalls-ID aus dem `localStorage` des Geräts. Damit erkennt die
Seite dich wieder und du änderst deine eigene Stimme, ohne dich anzumelden. Es gibt
keine Konten und keine Passwörter außer dem gemeinsamen Gruppenwort.

---

## Festlegen, Absagen, Kalender

**Festlegen darf jeder**, nicht nur wer die Abfrage gestartet hat. Sonst steht
die Runde still, wenn ausgerechnet der krank wird. Vor dem Festlegen kommt eine
Rückfrage mit der Lage im Klartext, bei gelb oder rot zusätzlich
„Achtung: So reicht es noch nicht."

**Absagen** geht für laufende Abfragen und für feststehende Termine. Der Grund
landet im WhatsApp-Text. Danach ist die Abfrage schreibgeschützt: Der Dienst
weist Stimmen mit 409 ab, und die Oberfläche zeigt statt der Antwort-Knöpfe nur
noch „Deine Antwort war: …".

**Kalendereintrag** als `.ics`, sobald ein Termin feststeht. Ohne Zeitzone — bei
einem Treffen vor Ort gilt der Termin in der Ortszeit des Geräts. Dauer
pauschal vier Stunden (`ABEND_STUNDEN` in `js/termine.js`). Zeilen sind nach
RFC 5545 auf 75 Oktetts gefaltet, gezählt in Bytes, damit Umlaute nicht mitten
im Buchstaben zerreißen.

---

## Das Banner auf der Startseite

`GET /api/current` liefert in **einer** Antwort beides: die neueste offene
Abfrage und den nächsten feststehenden Termin. Das Banner liegt über den Tabs
und ist damit auf jedem Tab sichtbar.

Es wird geladen, wenn die Seite startet, wenn man zur Seite zurückkommt
(`visibilitychange`, `focus`) und nach jedem Speichern. **Kein Abruf im
Sekundentakt** — D1 liefert bei Überschreiten der Gratis-Grenzen seit
September 2026 Fehler statt Verlangsamung.

Ohne Gruppenwort, ohne Netz oder ohne laufende Abfrage bleibt das Banner leer.
Es verrät also niemandem etwas, der das Wort nicht hat.

---

## Was hier gespeichert wird

Vornamen, gewählte Rolle und Verfügbarkeiten. **Sonst nichts.** Spielnotizen und
eigene Skripte bleiben wie bisher ausschließlich auf dem jeweiligen Gerät und
kommen hier nie an.
