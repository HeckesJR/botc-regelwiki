# Auf GitHub Pages veröffentlichen

Schritt für Schritt. Rechne mit 10–15 Minuten beim ersten Mal, danach sind Updates ein
Dreizeiler.

---

## Vorher einmal: Git-Identität setzen

Git weiß noch nicht, wer du bist. Ohne das schlägt der erste Commit fehl.

```bash
git config --global user.name "Jan Heckwolf"
```

```bash
git config --global user.email "janheckwolf@gmail.com"
```

> Die E-Mail landet öffentlich sichtbar in jedem Commit. Wenn dir das nicht recht ist:
> Auf GitHub unter *Settings → Emails* „Keep my email addresses private" aktivieren und
> stattdessen die dort angezeigte Adresse `…+username@users.noreply.github.com` eintragen.

---

## Schritt 1 — Repository auf GitHub anlegen

1. Auf [github.com](https://github.com) einloggen (falls noch kein Konto: kostenlos anlegen).
2. Oben rechts auf **+** → **New repository**.
3. Ausfüllen:
   - **Repository name:** `botc-regelwiki`
   - **Description:** *Deutschsprachiges Regelwiki für Blood on the Clocktower*
   - **Public** auswählen — Pages ist bei privaten Repos nur mit bezahltem Plan verfügbar.
   - **Wichtig:** *Add a README file*, *Add .gitignore* und *Choose a license* alle
     **leer lassen**. Wir bringen eigene Dateien mit; ein automatisch erzeugter Commit
     würde den ersten Push blockieren.
4. **Create repository** klicken.

Auf der nächsten Seite steht die Adresse deines Repos, etwa
`https://github.com/DEINNAME/botc-regelwiki.git`. Die brauchst du gleich.

---

## Schritt 2 — Projekt hochladen

Ab hier läuft alles im Terminal, nichts mehr im Browser.

### ⚠️ Zuerst: in den richtigen Ordner wechseln

Das ist die häufigste Fehlerquelle. Die Git-Befehle erfassen **immer den Ordner, in dem du
gerade stehst, samt allen Unterordnern**. Stehst du eine Ebene zu hoch in `Tool`, landet auch
das andere Projekt darin — inklusive der PDFs in `test-samples`.

```bash
cd C:\Users\janhe\Desktop\Tool\botc-regelwiki
```

Zur Kontrolle — hier muss `index.html` auftauchen, **nicht** ein Ordner `botc-regelwiki`:

```bash
dir
```

Siehst du in der Liste `index.html`, `css`, `js`, `data`? Dann stimmt es. Siehst du stattdessen
`botc-regelwiki` und `test-samples`, stehst du zu hoch — dann nochmal den `cd`-Befehl oben.

### Dann der Reihe nach

```bash
git init
```

```bash
git add .
```

```bash
git commit -m "Blood on the Clocktower Regelwiki"
```

```bash
git branch -M main
```

Jetzt die Verbindung zum Repo. **`DEINNAME` muss durch deinen echten GitHub-Benutzernamen
ersetzt werden** — kopierst du die Zeile unverändert, schlägt der Push später mit
„Repository not found" fehl:

```bash
git remote add origin https://github.com/DEINNAME/botc-regelwiki.git
```

Kontrolle, ob die Adresse stimmt:

```bash
git remote -v
```

Steht dort noch `DEINNAME`, korrigierst du es so:

```bash
git remote set-url origin https://github.com/DEINNAME/botc-regelwiki.git
```

```bash
git push -u origin main
```

**Beim ersten Push fragt Git nach einer Anmeldung.** Git für Windows öffnet dafür ein Fenster
(„Git Credential Manager") mit dem Knopf *Sign in with your browser*. Damit anmelden — fertig.
Ein Passwort im Terminal funktioniert bei GitHub seit 2021 nicht mehr.

---

## Schritt 3 — GitHub Pages einschalten

1. Im Repo oben auf **Settings**.
2. Links in der Seitenleiste auf **Pages**.
3. Unter *Build and deployment*:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main`, Ordner `/ (root)`
4. **Save** klicken.

Oben erscheint nach einer Weile ein grüner Kasten mit der Adresse:

```
https://DEINNAME.github.io/botc-regelwiki/
```

Der erste Build dauert **1 bis 3 Minuten**. Solange kommt eine 404 — einfach kurz warten und
neu laden. Den Fortschritt siehst du im Reiter **Actions**.

---

## Schritt 4 — Link an die Runde geben

Genau die Adresse aus Schritt 3 weitergeben. Das Repo ist zwar öffentlich, aber es ist nicht
verlinkt und taucht in keiner Suche prominent auf — wer den Link nicht hat, findet es
praktisch nicht.

Trag den Link am besten gleich oben in die `README.md` ein, dann findest du ihn später wieder.

---

## Später etwas ändern

Datei bearbeiten, dann im Projektordner:

```bash
git add . && git commit -m "Kurz was geändert wurde" && git push
```

Nach 1–2 Minuten ist die Änderung online. Wenn du die alte Version siehst: harter Reload mit
`Strg`+`F5`.

---

## Wenn etwas nicht klappt

**Die Seite zeigt 404, obwohl Pages an ist**
Prüfe unter *Settings → Pages*, ob Branch `main` und Ordner `/ (root)` steht. Und ob
`index.html` wirklich im Wurzelverzeichnis des Repos liegt — nicht in einem Unterordner
`botc-regelwiki/botc-regelwiki/`. Auf GitHub im Reiter *Code* nachsehen: Du solltest dort
direkt `index.html`, `css/`, `js/`, `data/` sehen.

**Seite lädt, aber ohne Inhalte („Daten konnten nicht geladen werden")**
Dann fehlt der `data/`-Ordner im Repo oder ein Dateiname weicht in der Groß-/Kleinschreibung ab.
Linux unterscheidet Groß- und Kleinschreibung, Windows nicht. Habe ich vor der Veröffentlichung
geprüft — sollte nicht auftreten, aber das wäre die Ursache.

**Icons fehlen, Text ist da**
Prüfen, ob `assets/icons/` mit hochgeladen wurde. Falls nicht: `git add assets -f`.

**`git push` wird abgelehnt („rejected", „fetch first")**
Dann hat GitHub beim Anlegen doch eine Datei erzeugt. Einmalig:

```bash
git pull --rebase origin main && git push
```

**Push hängt oder bricht ab**
Das Repo ist ~2,9 MB — das geht normalerweise in Sekunden. Bei hängender Verbindung
`Strg`+`C` und den Push wiederholen.

---

## Was du *nicht* tun solltest

**Keine Open-Source-Lizenz hinzufügen.** GitHub schlägt beim Anlegen MIT, Apache & Co. vor.
Diese Inhalte sind aber nicht deine, um sie zu lizenzieren: Die Regeltexte sind Übersetzungen
des offiziellen Regelwerks, und die Icons sind die offiziellen Token-Grafiken von The
Pandemonium Institute. Eine MIT-Lizenz würde behaupten, dass jeder damit machen darf, was er
will — das stimmt nicht. Der Hinweis im Footer und in der README ist die richtige Angabe.

**Das Repo nicht auf einer Fanseite oder in einem Forum bewerben.** Als privates Werkzeug für
die eigene Runde ist es von TPIs
[Community Created Content Policy](https://bloodontheclocktower.com/pages/community-created-content-policy)
gedeckt. Aktiv verbreitet wird daraus ein Angebot, das mit den offiziellen Ressourcen
konkurriert — und das ist ausdrücklich nicht erlaubt.

---

## Zum Nachschlagen: was liegt im Repo

| Datei | Wozu |
|---|---|
| `.nojekyll` | Verhindert, dass Pages die Seite durch Jekyll schickt. Ohne die Datei würde Jekyll `_devserve.ps1` und `_icon-sources.txt` ignorieren. |
| `.gitignore` | Hält Betriebssystem- und Editor-Müll aus dem Repo. |
| `404.html` | Themenpassende Fehlerseite statt der GitHub-Standardseite. |
| `_devserve.ps1` | Nur für lokales Testen. Stört online nicht. |
| `_icon-sources.txt` | Quell-URLs der Icons, falls sie mal erneuert werden müssen. |
