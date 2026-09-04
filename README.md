# Blood on the Clocktower — Regelwiki

Ein privates, deutschsprachiges Regelwiki für unsere Spielrunde. Statische Single-Page-Anwendung:
HTML + CSS + Vanilla JS, alle Inhalte als JSON. **Kein Build-Schritt** — läuft direkt auf GitHub Pages.

**🔗 Live:** https://heckesjr.github.io/botc-regelwiki/

**📤 Veröffentlichen:** Schritt-für-Schritt-Anleitung in [VEROEFFENTLICHEN.md](VEROEFFENTLICHEN.md)

---

## Schnellstart

**Lokal testen** (die JSON-Dateien werden per `fetch` geladen, ein reines Öffnen per Doppelklick
über `file://` blockiert der Browser):

```bash
powershell -ExecutionPolicy Bypass -File _devserve.ps1
```

Danach `http://localhost:8231/` öffnen. Mit `-Port 9000` lässt sich der Port ändern.

**Auf GitHub Pages veröffentlichen:** Repo anlegen, den Ordnerinhalt pushen, unter
*Settings → Pages* als Quelle den `main`-Branch / Root wählen. Es ist nichts zu bauen und
nichts zu konfigurieren.

---

## Ordnerstruktur

```
botc-regelwiki/
├── index.html
├── css/style.css
├── js/
│   ├── app.js           Tabs, Zustand, Daten laden, Verdrahtung
│   ├── render.js        Regeln, Glossar, Charakterkarten, Nachtreihenfolge
│   ├── search.js        Such- und Filterlogik
│   ├── generator.js     Verteilung, Bluffs, Balance-Bewertung, Vorschläge
│   ├── scripts.js       eigene, editionsübergreifende Skripte
│   ├── notes.js         Spielnotizen (Sitzordnung, Verdacht, Status)
│   ├── pdf-export.js    PDF-Export im Pergament-Design
│   └── sw-register.js   meldet den Service Worker an, zeigt die Update-Leiste
├── data/
│   ├── grundregeln_de.json
│   ├── glossar_de.json
│   ├── trouble_brewing.json
│   ├── bad_moon_rising.json
│   ├── sects_violets.json
│   ├── traveller_fabled.json
│   └── balance.json     Tags & Gewichte für den Balance-Check
├── assets/
│   ├── icons/{edition}/{charakter-id}.webp  99 offizielle Icons (+ .svg als Fallback)
│   └── textures/                            Pergament, Fleuron, Eckornament
├── vendor/jspdf.umd.min.js                  lokal eingebunden, kein CDN nötig
├── _icon-sources.txt                        Quell-URLs der offiziellen Icons
├── manifest.webmanifest                     macht die Seite auf dem Handy installierbar
├── sw.js                                    Service Worker für den Offline-Betrieb
└── _devserve.ps1                            nur zum lokalen Testen
```

---

## Datenmodell

Jeder Charakter folgt demselben Schema:

```json
{
  "id": "clockmaker",
  "edition": "sects_violets",
  "type": "townsfolk",
  "name_de": "Uhrmacher*in",
  "name_en": "Clockmaker",
  "ability_short": "…",
  "quote": "…",
  "full_text": "…",
  "examples": ["…"],
  "how_to_run": "…",
  "tips": ["…"],
  "wakes_first_night": true,
  "wakes_other_nights": false,
  "night_order_first": 9,
  "night_order_other": null,
  "icon": "assets/icons/sects_violets/clockmaker.webp"
}
```

`type` ∈ `townsfolk | outsider | minion | demon | traveller | fabled`.

**Optionale Felder:**

| Feld | Bedeutung |
|---|---|
| `setup_modifier` | z. B. `{"outsider": 2}` (Baron) oder `{"outsider_choice": [-1, 1]}` (Pate). Der Generator wendet das automatisch an. |
| `fabled_group` | `general` oder `custom` (Fabled für eigene Skripte) |
| `source_note` | Hinweis, dass der Text ergänzt wurde — wird auf der Karte angezeigt |

**Zusätzlich pro Editionsdatei:** `night_meta` (Abenddämmerung, Schergen-Info, Dämon-Info,
Morgendämmerung mit ihren Positionen) und `setups` (die kuratierten Vorlagen).

### Formatierung in den Texten

- `**fett**` und `*kursiv*` werden gerendert.
- Leerzeile = neuer Absatz.
- Zeilen mit führendem `•` werden zu einer Aufzählung.
- Alles wird vor dem Rendern escaped — keine HTML-Injection aus den Daten möglich.

---

## Deutsche Kategorie-Begriffe

| Englisch | Deutsch |
|---|---|
| Townsfolk | Bürger |
| Outsider | Außenseiter |
| Minion | Schergen |
| Demon | Dämon |
| Storyteller | Geschichtenerzähler\*in |
| Traveller | Reisende |

---

## Die sechs Tabs

**Grundregeln** — Fließtext mit Initialen, Spieleranzahl-Tabelle, Handzeichen, Nominierung &
Exekution, betrunken/vergiftet, Wahnsinn, Gesinnung. Darunter das Glossar mit 79 Begriffen,
nach Kategorien gruppiert und durchsuchbar.

**Charaktere** — Editions-Umschalter, Typ-Filter-Chips, Suche über Name und Kurzbeschreibung.
Klick auf eine Karte fährt sie über die volle Rasterbreite aus und zeigt Zitat, vollen
Fähigkeitstext, Beispiele, „So leitest du ihn/sie" und Tipps.

- Wählst du eine Edition, sind die **fünf zugehörigen Reisenden mit eingemischt** — sie
  erscheinen unter dem Filter-Chip „Reisende".
- Unter „Reisende & Fabled" liegen alle 15 Reisenden und 12 Fabled zusammen.
- Filter-Chips für Typen, die eine Edition nicht kennt, werden ausgeblendet (bei
  „Reisende & Fabled" gibt es folglich nur zwei Chips).

**Nachtreihenfolge** — Editions- und Phasen-Umschalter. Die Liste wird **live aus
`night_order_first` / `night_order_other` erzeugt und sortiert**. Es gibt keine zweite Liste,
die veralten könnte: Änderst du eine Zahl am Charakter, ändert sich die Reihenfolge mit.

**Generator** — Spieleranzahl 5–20 plus Skript (Edition oder eigenes Skript). Zeigt die
Grundverteilung, schlägt bis zu drei Setups vor, nennt zu jedem die **3 Bluffs für den Dämon**
und exportiert alles als PDF. Drei Modi:

| Knopf | Was er tut |
|---|---|
| **Setups vorschlagen** | Kuratierte Vorlagen, nach Nähe zur Spieleranzahl sortiert. Gibt es zu wenige, wird mit ausgewogenen Runden aufgefüllt. |
| **Ausgewogene Runde** | Zieht 300 Zufallsrunden, bewertet jede und zeigt die drei besten. Jeder Klick würfelt neu. |
| **Rein zufällig** | Ein einzelner Zufallszug ohne Bewertung — für spontane Abende. |
| **Skriptblatt als PDF** | Das Charakterblatt zum Ausdrucken für den Tisch — alle Charaktere des Skripts, im Aufbau des offiziellen Handouts. |

**Eigene Skripte** — Baukasten für editionsübergreifende Skripte. Charaktere aus Trouble Brewing,
Bad Moon Rising und Sects & Violets frei kombinieren; das Tool zeigt laufend die Typ-Verteilung
und für welche Spieleranzahlen das Skript reicht. Gespeichert wird im `localStorage` des
Browsers, danach steht das Skript im Generator zur Auswahl.

**Notizen** — Das einzige Werkzeug für *während* der Partie, gedacht für Spieler (der
Geschichtenerzähler hat sein Grimoire). Oben Skript und Spielerzahl mit der Verteilungstabelle,
darunter eine Karte je Spieler:

- **Sitzordnung** statt bloßer Liste, mit ▲▼ verschiebbar. Jede Karte nennt ihre beiden
  **lebenden** Nachbarn — tote werden übersprungen. Das ist der Punkt, an dem Empath-Zahlen,
  Koch, Uhrmacher, Teedame und No Dashii überhaupt nachrechenbar werden.
- **Behauptet und vermutet getrennt.** Was jemand zu sein *behauptet* und was du *glaubst*,
  sind zwei Felder. Die Lücke dazwischen ist das Spiel.
- **Vermutungen haben drei Zustände:** einmal tippen = verdächtig, zweimal = ausgeschlossen,
  dreimal = zurück auf neutral. Ein „ist nicht der Giftmischer" ist oft mehr wert als ein Verdacht.
- **Status und Ampel:** lebt / tot / Geisterstimme verbraucht, dazu gut / unklar / böse — die
  Ampel färbt die ganze Karte, sodass ein Blick über die Liste reicht.
- **Von niemandem behauptet:** leitet aus Skript und Verteilung ab, welche Rollen noch offen sind.
- **Zwei Reset-Stufen:** „Neue Runde" behält Namen und Sitzordnung und leert den Rest,
  „Alles löschen" räumt komplett auf. Beide fragen vorher nach.

Alles wird beim Tippen automatisch im `localStorage` gesichert — es gibt keinen Speichern-Knopf,
und nichts verlässt das Gerät.

---

## Generator-Logik

Die offizielle Grundverteilung ist in `generator.js` als Tabelle hinterlegt (5–15 Spieler; ab 16
gilt die 15er-Zeile, jeder weitere Spieler ist ein Reisender).

**Setup-Modifikatoren** werden automatisch angewendet: Baron `+2`, Fang Gu `+1`, Vigormortis `−1`,
Pate `±1` Außenseiter. Es werden immer Bürger gegen Außenseiter getauscht, die Gesamtzahl bleibt
gleich. Dabei gilt: nie mehr Außenseiter, als das Skript überhaupt kennt, und nie weniger als
ein Bürger. Jede Anpassung wird im Ergebnis als Hinweis ausgewiesen.

**Bluffs.** Zu jedem Setup werden 3 gute Charaktere gezogen, die *nicht* im Spiel sind — genau
das, was der Dämon in der ersten Nacht gezeigt bekommt. Bürger werden bevorzugt, weil sie die
glaubwürdigeren Bluffs sind; Außenseiter füllen nur auf, wenn nicht genug Bürger übrig sind.
Mit „Andere Bluffs" lassen sie sich neu ziehen, ohne das Setup zu verändern.

**Setup-Auswahl.** Kuratierte Vorlagen werden nach Nähe zur gewünschten Spieleranzahl sortiert.
Passt eine exakt, wird sie unverändert übernommen. Sonst wird sie skaliert — Dämon und Schergen
der Vorlage bleiben gesetzt, der Rest wird aufgefüllt. Solche Setups tragen „Vorlage für N
Spieler, erweitert".

### Der Balance-Check

Statt einmal zufällig zu ziehen, zieht der Generator bis zu 300 Kandidaten, bewertet jeden und
behält die besten. Grundlage sind Tags pro Charakter in `data/balance.json` — sie beschreiben,
*was* ein Charakter tut (`info-ongoing`, `protect`, `kill`, `disrupt`, `selfharm`, `passive` …).

Bewertet wird auf einer Skala von 0 bis 100:

| Prüfung | Wirkung |
|---|---|
| Kein Bürger liefert nach Nacht 1 noch Information | −30 — das gute Team fliegt blind |
| Insgesamt sehr wenig Information | −18 |
| Mehrere Töter bei Böse, aber kein Schutz | −22 |
| Gar kein Schutz | −8, mit Schutz +8 |
| Mehr als die Hälfte der Bürger ist passiv | −14 |
| Böse kann Informationen nicht verfälschen | −12 |
| Störung vorhanden **und** Information vorhanden | +8 |
| Mindestens eine Tagfähigkeit | +5 |
| Abwechslung (Anzahl verschiedener Tags) | bis +10 |

Die Punktzahl steht als Etikett am Setup, und die Begründung unter dem Namen wird aus denselben
Prüfungen erzeugt — du siehst also immer, *warum* eine Runde als gut oder schwach gilt.

Die Gewichte stehen ebenfalls in `data/balance.json` und lassen sich anpassen. Wer etwa findet,
dass Schutz überbewertet ist, dreht `schutz_vorhanden` herunter — die Vorschläge ändern sich
sofort, ohne Code-Änderung.

---

## PDF-Export

Läuft vollständig im Browser über das lokal eingebundene jsPDF (`vendor/`) — kein CDN, keine
Netzwerkabhängigkeit. Das PDF übernimmt das Pergament-Design: getönter Grund, Doppelrahmen mit
Eckrauten, ornamentale Trennlinien, Verteilungskästchen in Blau/Rot, Charakterliste nach Typ
gruppiert, Begründungstext und Hinweise, Fußzeile mit Seitenzahl. Mehrseitige Setups werden
sauber umbrochen.

Die eingebauten jsPDF-Schriften können nur WinAnsi darstellen. Umlaute und ß funktionieren;
einige typografische Sonderzeichen werden vor dem Setzen auf sichere Entsprechungen abgebildet
(siehe `PDF_REPLACEMENTS` in `pdf-export.js`).

### Skriptblatt zum Ausdrucken

Zusätzlich zum Setup-PDF gibt es das **Charakterblatt** im Aufbau des offiziellen Handouts:
Kopfzeile mit Skriptnamen, zwei Spalten, Typ-Abschnitte mit senkrechtem Seitenlabel
(BÜRGER · TOWNSFOLK), Icon und Kurzfähigkeit je Charakter, Sternchen-Fußnote unten. Zu finden
im Generator und im Skript-Baukasten.

Drei Dinge, die dabei technisch nötig waren:

- **jsPDF kann kein WebP.** Die Icons werden über ein Canvas nach JPEG umgewandelt, mit der
  Pergamentfarbe als Grund — sonst säßen sie als weiße Kästchen auf dem Blatt. PNG statt JPEG
  bläht ein 25-Charakter-Blatt von 83 kB auf 1,7 MB auf.
- **Der Titel steht in Grenze Gotisch.** jsPDF kennt nur seine eingebauten Schriften; eine TTF
  einzubetten würde jedes PDF um rund 150 kB vergrößern und die Schrift mitverteilen.
  Stattdessen wird der Titel im Browser auf ein Canvas gezeichnet — die Seite hat die Schrift
  ohnehin geladen — und als Bild eingesetzt. Gleiche Optik, ein paar Kilobyte. Klappt das
  Canvas nicht, fällt der Titel automatisch auf die eingebaute Serifenschrift zurück.
- **Die Schriftgröße passt sich an.** Sie schrumpft von 8 pt bis 5,6 pt, damit möglichst alles
  auf eine Seite passt. Reicht das nicht (etwa bei einem Skript aus allen 72 Charakteren),
  bricht das Blatt sauber auf mehrere Seiten um — mit „(Fortsetzung)" im Kopf und Seitenzahlen.

---

## Design

- Pergament-Textur als gekachelte SVG mit `feTurbulence`, dazu eine Vignette über der ganzen Seite
- Bordeaux `#5c1f2e` für Überschriften, Rahmen und aktive Tabs; Gold `#a8894c` für Ornamente
- Blau `#274a78` für Bürger/Außenseiter, Dunkelrot `#7c1c22` für Schergen/Dämon,
  Gold für Reisende/Fabled
- Schriften: **Grenze Gotisch** (Titel), **EB Garamond** (Fließtext),
  **IM Fell English SC** (Kapitälchen-Labels) — via Google Fonts, mit Serifen-Fallbacks
- Initialen am Absatzanfang, Fleuron-Trenner, vertikale Seitenreiter und Eckornamente
  nach dem Vorbild des Regelwerks
- Responsiv bis 375 px, `prefers-reduced-motion` wird respektiert, Druck-Stylesheet vorhanden

---

## Inhaltsstand & wichtige Hinweise

Alle sechs zugelieferten PDFs sind ausgewertet. Fünf davon waren reine Bild-Scans ohne
Textebene und wurden seitenweise gerendert und gelesen.

| Inhalt | Umfang | Quelle |
|---|---|---|
| Grundregeln | 14 Abschnitte | offizielles Regelbuch (`Grundregeln.pdf`), aus dem Englischen |
| Glossar | **79** Begriffe | Glossar des offiziellen Regelbuchs, vollständig übersetzt |
| Trouble Brewing | **22** Charaktere | offizieller Almanach (`tb.pdf`), aus dem Englischen |
| Bad Moon Rising | **25** Charaktere | offizieller Almanach (`BadMoon.pdf`) + Spieler-Handout |
| Sects & Violets | **25** Charaktere | `sects_violets_de.md`, Gelehrte\*r aus `Sects.pdf` ergänzt |
| Reisende & Fabled | **27** Charaktere | `traveller_fabled_de.md`, gegen `Traveller.pdf` geprüft |
| Icons | 99 Grafiken | offizielle Token-Art von script.bloodontheclocktower.com |

**Was beim Abgleich mit den Regelwerken herauskam:**

1. **Trouble Brewing hat 22 Charaktere, nicht 17.** Der ursprüngliche Prompt nannte 17; die
   Edition besteht aus 13 Bürgern, 4 Außenseitern, 4 Schergen und 1 Dämon.

2. **Trouble Brewing und Bad Moon Rising stammen aus den offiziellen Almanachen.** Regeldetails,
   Beispiele und „So leitest du ihn/sie" sind inhaltlich die offiziellen Texte.

3. **Sects & Violets und Reisende & Fabled wurden gegen die Originalbücher geprüft** — eure
   Übersetzungen sind originalgetreu und blieben unverändert. Ergänzt wurde nur der/die
   **Gelehrte\*r (Savant)**, der in eurer Datei nur in der Referenzliste stand.

4. **Das Glossar wurde vollständig ersetzt** (vorher 34 selbst zusammengestellte Begriffe,
   jetzt 79 aus dem offiziellen Glossar). Es klärt jetzt auch Regelfragen, die im Spiel wirklich
   aufkommen — etwa der Unterschied zwischen „wählen" (der Spieler entscheidet) und „könnte"
   (der/die Geschichtenerzähler\*in entscheidet).

5. **Deutsche Namen aus dem offiziellen Handout übernommen**, wo sie von meinen abwichen:
   *Advocatus/-a Diaboli* und *Assassine/Assassinin*.

**Beim Gegenlesen gefundene Regelfehler** (falls ihr eine frühere Fassung schon gelesen habt):

- Ein **toter Butler darf frei abstimmen** — Tote verlieren ihre Fähigkeit.
- Beim **Imp-Selbstmord wählt der/die Geschichtenerzähler\*in** den neuen Imp, nicht der Imp.
- **Betrunken/vergiftet ist der Spieler, nicht der Charakter.** Wechselt er den Charakter,
  bleibt er betrunken bzw. vergiftet.
- Eine Fähigkeit, die **während** der Betrunkenheit ausgelöst wird, ist verschwendet — auch
  wenn der Spieler später wieder nüchtern wird. Umgekehrt wirkt eine nüchtern ausgelöste
  Fähigkeit normal, selbst wenn sie sich auf eine Zeit bezieht, in der er betrunken war.
- **Gleichstand bei der Abstimmung** bedeutet keine Exekution; gezählt wird im Uhrzeigersinn,
  endend beim Nominierten.

**Was weiterhin von mir stammt und nicht offiziell ist:**

- Die **Zitate für Bad Moon Rising** — der BMR-Almanach enthielt keine Charakter-Zitate.
- Die **Setups für Trouble Brewing und Bad Moon Rising** — in den Almanachen standen keine
  empfohlenen Setups. In der Oberfläche mit „Zusammengestellt" gekennzeichnet; nur die fünf
  Sects-&-Violets-Setups tragen „Aus dem Regelwerk".
- Alle Übersetzungen aus dem Englischen (Trouble Brewing, Grundregeln, Glossar, Savant) — mit
  der Terminologie aus eurem Glossar: Bürger / Außenseiter / Schergen / Dämon.

### Zu den Icons

Die 99 Charakter-Icons sind die offiziellen Token-Grafiken von
[script.bloodontheclocktower.com](https://script.bloodontheclocktower.com/), als WebP im Repo
abgelegt. Zwei Dinge dazu:

- Die Original-Dateinamen enthalten Build-Hashes, die sich bei jedem Deploy von TPI ändern.
  Die verwendeten Quell-URLs stehen in `_icon-sources.txt`; zum Aktualisieren dort die neuen
  URLs eintragen.
- Die ursprünglich generierten SVG-Embleme liegen weiterhin unter demselben Pfad mit der
  Endung `.svg`. Fehlt ein WebP, fällt die Karte automatisch darauf zurück.

TPIs [Community Created Content Policy](https://bloodontheclocktower.com/pages/community-created-content-policy)
erlaubt die Nutzung der Token-Art für nicht-kommerzielle Community-Inhalte. Sie bittet darum,
solche Projekte klar als nicht-offiziell zu kennzeichnen — der Hinweis dazu steht im Footer.
Wer mag, kann zusätzlich das offizielle „Community Created Content"-Logo einbinden.

---

## Inhalte pflegen

**Charaktertext ändern** — die betreffende Datei in `data/` bearbeiten. Kein Build, einfach neu laden.

**Nachtreihenfolge ändern** — `night_order_first` / `night_order_other` am Charakter anpassen.
Die Nummern müssen innerhalb einer Edition und Phase eindeutig und lückenlos sein; nicht
vergessen, `night_meta` mitzuziehen, wenn sich Positionen verschieben.

**Neues Setup hinzufügen** — Eintrag im `setups`-Array der Edition:

```json
{
  "id": "tb-mein-setup",
  "name": "Mein Setup",
  "players": 9,
  "curated": false,
  "difficulty": "Mittel",
  "characters": ["washerwoman", "chef", "…"],
  "reason": "Warum dieses Setup funktioniert."
}
```

**Neuen Charakter hinzufügen** — Objekt nach obigem Schema ins `characters`-Array einfügen und
eine SVG-Datei unter dem in `icon` angegebenen Pfad ablegen (viewBox `0 0 64 64`,
`stroke="currentColor"`).

---

## Offline-Betrieb (Service Worker)

`sw.js` macht die Seite ohne Netz benutzbar. Der übliche Ärger mit Service Workern — sie
liefern hartnäckig alte Stände aus — ist hier durch getrennte Strategien entschärft:

| Dateiart | Strategie | Folge |
|---|---|---|
| HTML, JS, CSS, JSON | **erst Netz**, Cache nur als Rückfall | online immer der frische Stand |
| Bilder, Icons, Schriften | **erst Cache** | spart die 3,4 MB bei jedem Aufruf |

Kein Netz nach vier Sekunden gilt als kein Netz, dann übernimmt der Cache. Beim ersten Besuch
wird alles außer den 198 Charakter-Icons vorgeladen; die kommen nach, sobald sie einmal
angezeigt wurden.

> **Beim Ändern von Bildern, Icons oder Schriften `VERSION` in `sw.js` hochzählen.**
> Sonst behält jeder, der die Seite schon einmal geöffnet hat, die alten Bilder — unbegrenzt.
> Für HTML, JS, CSS und die JSON-Daten ist das **nicht** nötig, die kommen ohnehin frisch.

Liegt eine neue Fassung bereit, erscheint unten eine Leiste „Eine neue Fassung des Regelwikis
ist da" mit *Jetzt laden* und *Später*. Es wird **nie** automatisch neu geladen — mitten in
einer Partie sollen einem die Notizen nicht unter den Fingern verschwinden.

**Beim Entwickeln:** Der Service Worker läuft auf `localhost` mit. Wenn du Änderungen nicht
siehst, in den Entwicklerwerkzeugen unter *Application → Service Workers* „Update on reload"
anhaken oder „Unregister" drücken. Über `file://` meldet er sich gar nicht erst an.

---

## Rechtliches

Blood on the Clocktower ist ein Spiel von Steven Medway, veröffentlicht von The Pandemonium
Institute. Dieses Wiki ist eine inoffizielle, nicht-kommerzielle Zusammenfassung für den
privaten Gebrauch der eigenen Spielrunde und enthält keine Original-Grafiken des Spiels.
