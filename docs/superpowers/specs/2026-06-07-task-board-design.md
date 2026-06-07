# Task-Board für DM_Workspace — Design

**Datum:** 2026-06-07
**Status:** Freigegeben (Brainstorming abgeschlossen)
**Scope:** Eigenständiges, leichtgewichtiges Feature. Eines von drei Nice-to-haves nach BridgeSpace-Vorbild (Task-Board, Datei-Browser, Terminal-Kleinigkeiten); Datei-Browser und Terminal-Wins bekommen jeweils eine eigene Spec.

## 1. Zweck & Leitplanke

Ein leichtgewichtiges Kanban-Board pro Arbeitsverzeichnis. Tasks leben als Markdown im
Projektordner, lassen sich auch vom Terminal/Editor anfassen, und ein Task kann per Klick
als Befehl/Prompt in ein gewähltes Terminal-Pane geschickt werden.

**Oberste Leitplanke:** Das Terminal bleibt der Kern von DM_Workspace. Das Board ist eine
zuschaltbare Ansicht, kein Dauer-Mitbewohner, und darf das bestehende, schlanke Verhalten
nicht verwässern. Im Zweifel: weniger.

Inspiration: BridgeSpace (BridgeMind) — dortiges Kanban-Board (Spalten Todo / In Progress /
In Review / Complete) füttert KI-Agenten. Wir übernehmen das Grundprinzip „Task = Arbeits-
auftrag im Projektordner, per Klick ins Terminal" — **ohne** Agenten-Orchestrierung. Der
Nutzer steuert selbst, in welches Pane ein Task geht.

## 2. Speicher & Format

- **Datei:** `<arbeitsverzeichnis>/.dmworkspace/TASKS.md`
- **Git:** Beim ersten Anlegen trägt die App `.dmworkspace/` idempotent in die `.gitignore`
  des Repos ein → Tasks landen nie in GitHub. Kein Git-Repo vorhanden → Schritt wird
  übersprungen (kein Fehler).
- **Bindung:** Tasks gehören zum Arbeitsverzeichnis, nicht zum Workspace-Eintrag. Zwei
  Workspaces mit demselben Verzeichnis teilen sich dieselbe `TASKS.md`.
- **Format:** Spalten = Markdown-Überschriften (`##`), Tasks = Checkbox-Listenpunkte.

  ```markdown
  ## Todo
  - [ ] Build fixen `npm run build`
  - [ ] pty-manager auf Login-Shell prüfen

  ## Doing
  - [ ] Refactor TerminalView Scrollback-Puffer

  ## Done
  - [x] Release 0.6.2
  ```

- **Run-Befehl-Konvention:** Optionaler Text in Backticks am Zeilenende = der Befehl, den
  „▶ Run" sendet. Ohne Backticks wird der Task-Titel selbst gesendet (ideal als Prompt an
  Claude/Codex im Pane). Wird live verifiziert und ggf. nachgeschärft.
- **Spalten:** Default Todo / Doing / Done. Parser ist tolerant und zeigt **die Überschriften,
  die in der Datei stehen** — eine von Hand ergänzte 4. Überschrift taucht im Board auf.
- **Checkbox-Semantik:** Spaltenzugehörigkeit ergibt sich aus der Überschrift. Verschieben
  nach „Done" setzt zusätzlich `[ ]`→`[x]` (und umgekehrt), damit die Datei auch in
  GitHub/Editor stimmig aussieht.

## 3. UI (Platzierung B + Run-Target C)

- **Umschalter oben:** `Terminals ⇄ Tasks`. Die linke Workspace-Sidebar bleibt in beiden
  Ansichten sichtbar.
- **Task-Ansicht:** 3-Spalten-Board für das Arbeitsverzeichnis des **aktiven** Workspace.
- **Drag & Drop:** Tasks zwischen Spalten ziehen → schreibt die Markdown-Zeilen um (inkl.
  Checkbox-Flip). Reihenfolge innerhalb einer Spalte = Zeilenreihenfolge.
- **Task-Karte:** Titel, optionaler Befehl, Button `▶ Run → Pane X (cmd) ⌄`.
  - Klick auf den Button: schaltet zurück zu **Terminals**, fokussiert das angezeigte (=
    zuletzt aktive) Pane und tippt den Befehl/Titel hinein.
  - `⌄` öffnet den Pane-Picker: listet die Panes des aktiven Workspace mit laufendem Befehl
    als Hinweis (`claude`, `npm dev`, …) plus „＋ neues Pane".
- **Bearbeiten:** „＋ Task" pro Spalte, Inline-Edit von Titel und Befehl, Löschen.

## 4. Architektur & Datenfluss

Folgt den bestehenden Mustern (`state.json`, `scrollback.ts`, main/preload/renderer-Trennung).

- **`taskStore` (main):** liest/schreibt `TASKS.md`, parst Markdown ↔ Task-Modell
  (round-trip-fähig). Analog zu `scrollback.ts`. Schreibt immer die ganze Datei neu.
- **File-Watcher (main):** erkennt externe Änderungen (Nutzer oder Claude editiert die Datei)
  → debounced IPC an den Renderer → Board aktualisiert. Bidirektional.
- **Echo-Guard:** Der Watcher ignoriert den von der App selbst ausgelösten Write (z. B. via
  Hash/Timestamp des letzten eigenen Schreibvorgangs), damit kein Schreib-Ping-Pong entsteht —
  gleiches Prinzip wie der Scrollback-Debounce.
- **Renderer:** Board-Komponente mit eigenem zustand-Slice. Die Run-Aktion nutzt die
  bestehende „Text in Pane einfügen"-IPC (dieselbe wie Paste), fokussiert das Pane und schaltet
  die Ansicht zurück auf Terminals.

### Units / Verantwortlichkeiten

| Unit | Was | Abhängigkeiten |
|------|-----|----------------|
| `taskStore` (main) | TASKS.md lesen/schreiben, gitignore pflegen | fs, parser |
| `tasks-markdown` (shared) | Parser/Serializer Markdown ↔ Task-Modell | — |
| `taskWatcher` (main) | fs.watch + debounce + Echo-Guard | taskStore |
| Board-UI (renderer) | Ansicht, Drag&Drop, Run, Inline-Edit | zustand-Slice, IPC |
| IPC-Bridge (preload) | tasks:load / tasks:save / tasks:changed | — |

## 5. Edge-Cases

- Kein `.dmworkspace/TASKS.md` → leerer Board-Zustand + „erste Task anlegen". Datei wird erst
  beim ersten Task erstellt (kein Müll in jedem Verzeichnis).
- Kein Git-Repo → `.gitignore`-Schritt übersprungen.
- Manuell kaputtes/ungewöhnliches Markdown → tolerant parsen, nichts wegwerfen, im Zweifel als
  Todo anzeigen.
- Run ohne vorhandenes Pane → Picker bietet nur „＋ neues Pane".
- Datei wird extern gelöscht → Board fällt auf leeren Zustand zurück.

## 6. Tests

- **Unit (vitest):**
  - Markdown-Parser ↔ Modell round-trip (inkl. Backtick-Befehl, Checkbox-State, unbekannte
    Überschriften).
  - Echo-Guard verhindert Selbst-Trigger.
  - gitignore-Eintrag ist idempotent.
- **e2e (Playwright):**
  - Task anlegen → erscheint in `TASKS.md`.
  - Externe Dateiänderung → Board aktualisiert sich.
  - Run → Befehl landet im gewählten Pane, Ansicht wechselt zurück zu Terminals.

## 7. Explizit NICHT im Scope (YAGNI)

- KI-Agenten-Orchestrierung / automatische Pane-Wahl / Rollen.
- Frei konfigurierbare Spalten-UI (Markdown erlaubt es manuell, die App bietet keine Editier-UI dafür).
- Task-Metadaten wie Fälligkeit, Labels, Zuweisungen.
- Sync über mehrere Geräte (das macht ggf. Git/Syncthing, nicht die App).
- „In Review"-Spalte (4. Spalte) als Default.
