# Session-Restore-Treue — Design

**Datum:** 2026-05-27
**Status:** Entwurf zur Review

## Problem

Beim Neustart der App (Prozess neu gestartet, Sitzung wiederhergestellt) sieht das
Layout zerschossen aus (siehe gemeldeter Screenshot). Drei unabhängige Ursachen:

1. **Fenstergröße wird nicht wiederhergestellt.** `src/main/index.ts:41-42` öffnet das
   Fenster immer fest mit `1400×900`. Hatte der Nutzer vorher eine andere Größe oder ein
   maximiertes Fenster, hat das Terminal-Raster eine andere Spaltenzahl. Die gespeicherte
   Historie wird in ein anders breites Raster nachgespielt → hart umgebrochene Zeilen
   passen nicht mehr → Reflow-Salat.

2. **Roher Scrollback-Replay.** `TerminalView.tsx:107-157` schneidet die **rohen
   PTY-Bytes** mit und schreibt sie beim Neustart 1:1 ins frische xterm zurück. Das
   enthält Steuerzeichen, Farb-Query-Antworten (`^[]10;rgb…`, `^[]11;…`),
   Alternate-Screen-Umschaltungen und Cursor-Positionierung von Vollbild-TUIs
   (codex/claude). Roh zurückgespielt → die Müll-Fragmente aus dem Screenshot.

3. **Echo des cwd-Hooks.** `src/main/pty-manager.ts:88-90` schreibt den
   cwd-Reporting-Hook per `proc.write(...)` als getippten Befehl in die Shell. zsh/bash
   **echoen** ihn (`__dmws_cwd(){ printf … }`). Beim Neustart steckt er im Scrollback
   *und* wird frisch erneut injiziert → mehrfach sichtbar. Auch im Live-Betrieb steht er
   oben in jedem frischen Pane.

## Ziel

Nach einem Neustart soll die wiederhergestellte Sitzung sauber aussehen: gleiche
Fenstergröße wie zuletzt, lesbare Historie ohne Steuerzeichen-Müll, kein sichtbarer
Hook-Befehl.

## Lösung im Überblick

Drei Bausteine, unabhängig umsetzbar und testbar:

- **A — Fenster-Bounds persistieren/wiederherstellen** (Main-Prozess)
- **B — Scrollback über `SerializeAddon` statt Roh-Bytes** (Renderer)
- **C — cwd-Hook ohne stdin-Echo injizieren** (Main-Prozess)

---

## Baustein A — Fenster-Bounds

### Datenmodell

`AppState` (`src/shared/types.ts`) bekommt ein optionales Feld:

```ts
export interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface AppState {
  version: 1;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  settings: Settings;
  windowBounds?: WindowBounds; // optional; fehlt bei Erststart → Default 1400×900
}
```

`isValid()`/`deserialize()` in `persistence.ts` müssen den fehlenden bzw. fehlerhaften
Fall tolerieren (kein Crash, kein Reset des restlichen States). `version` bleibt `1`, da
das Feld optional und abwärtskompatibel ist.

### Lese-/Schreibpfad

Die Fenster-Bounds werden **vom Main-Prozess selbst** verwaltet, nicht vom Renderer, weil
nur der Main die `BrowserWindow`-Bounds kennt und das Fenster vor dem ersten Render
erzeugt wird.

- **Schreiben:** Neuer IPC-unabhängiger Pfad im Main. Auf `'resize'` und `'move'` des
  Fensters (debounced ~500 ms) sowie auf `'maximize'`/`'unmaximize'` werden die Bounds in
  `state.json` aktualisiert. Da der Renderer denselben State über `state:save` schreibt,
  muss der Schreibpfad konfliktfrei sein:
  - Der Main liest die aktuelle `state.json`, setzt nur `windowBounds`, schreibt zurück
    (read-modify-write über die vorhandenen `loadStateFromFile`/`saveStateToFile`).
  - Beim Speichern von Bounds im maximierten Zustand wird `getNormalBounds()` verwendet,
    damit nach dem Wiederherstellen das *entmaximierte* Fenster die richtige Größe hat.

- **Lesen/Anwenden:** In `createWindow()` wird `loadStateFromFile(STATE_FILE()).windowBounds`
  gelesen. Vorhandene Werte überschreiben die Defaults im `BrowserWindow`-Konstruktor.
  Bei `isMaximized: true` wird nach `ready-to-show` `mainWindow.maximize()` aufgerufen.
  - **Sichtbarkeits-Clamp:** Liegt die gespeicherte Position außerhalb aller aktuell
    angeschlossenen Displays (Monitor abgesteckt), wird `x/y` verworfen und das Fenster
    zentriert geöffnet (Größe bleibt erhalten). Prüfung über `screen.getAllDisplays()`.

### Tests

- `persistence.test.ts`: Round-Trip mit/ohne `windowBounds`; defekter/fehlender Wert
  fällt nicht auf `defaultState()` zurück, sondern lässt den Rest intakt.
- Reine Bounds-Clamp-Logik (innerhalb/außerhalb Display) als pure Funktion ausgelagert
  und unit-getestet.

---

## Baustein B — Scrollback über SerializeAddon

### Ansatz

Neues Dev-Dependency `@xterm/addon-serialize@^0.13.0` (kompatibel zu xterm 5.5.0).

Statt rohe `data`-Bytes mitzuschneiden, wird beim Speichern der **gerenderte
Terminal-Puffer** serialisiert: `serializeAddon.serialize()` liefert den normalen
Puffer (Scrollback + sichtbarer Bereich) als Text mit SGR-Farbcodes, ohne
Alt-Screen-Inhalt, ohne Farb-Query-Antworten, ohne Cursor-Sprungsequenzen.

In `TerminalView.tsx`:

- `SerializeAddon` laden (neben Fit/Search).
- Die `capture()`-Logik (rollender `buffer`, `MAX_BUFFER`-Trim) entfällt. Stattdessen
  liefert der Save-Pfad `serializeAddon.serialize({ scrollback: N })`.
- Der Debounce-Mechanismus (1 s) und der Flush beim Unmount bleiben; nur die Datenquelle
  wechselt von `buffer` auf `serialize()`.
- `onData` muss nicht mehr `capture(data)` aufrufen; der Save wird beim Output getriggert
  (debounced), liest dann aber den serialisierten Zustand.
- Replay (`restoreOnce`) bleibt strukturell gleich: gespeicherten Text einmal vor dem
  frischen Prompt `term.write(...)`, danach der Wiederherstellungs-Marker. Serialisierter
  Text reflowt sauber, weil er zeilenbasiert ist und das Raster die aktuelle Breite hat.

`scrollback.ts` (Main) bleibt unverändert (speichert weiter einen String pro Pane); die
`truncateScrollback`-Kappung greift weiterhin als Sicherheitsnetz gegen unbegrenztes
Wachstum, auch wenn `serialize({ scrollback: N })` die Zeilen schon begrenzt.

### Scrollback-Tiefe

`serialize({ scrollback: N })` begrenzt die exportierten Scrollback-Zeilen. Wert so
wählen, dass mehrere Bildschirme Historie erhalten bleiben, ohne `scrollback.json`
aufzublähen (Vorschlag: `N = 1000` Zeilen; final beim Umsetzen anhand der Dateigröße
gegenprüfen).

### Tests

- Serialize/Replay ist primär Integrationsverhalten von xterm; Unit-Tests decken die
  reine Save-Trigger-/Debounce-Logik ab (sofern extrahierbar). Die Wirkung wird zusätzlich
  manuell und über das bestehende e2e-Persistenz-Setup (`DMWS_USERDATA`) verifiziert:
  Sitzung mit Output → Neustart → Historie lesbar, keine `^[]…`-Fragmente.

---

## Baustein C — cwd-Hook ohne Echo

stdin-Injektion wird durch Startdatei-/Umgebungs-Injektion ersetzt — pro Shell:

- **bash:** Den Hook über die Umgebungsvariable `PROMPT_COMMAND` setzen — der
  printf-Befehl steht direkt darin (keine separate Funktionsdefinition nötig):
  `env.PROMPT_COMMAND = String.raw`printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"``.
  Bash übernimmt ein geerbtes `PROMPT_COMMAND` — kein Echo.
- **zsh:** `ZDOTDIR` auf ein generiertes Integrations-Verzeichnis unter
  `userData/shell-integration/` zeigen lassen. Dort liegen Weiterleitungs-Startdateien
  (`.zshenv`, `.zprofile`, `.zshrc`, `.zlogin`), die jeweils `ZDOTDIR` auf das
  Original (`USER_ZDOTDIR`, per env gesetzt) zurücksetzen und die echte
  User-Startdatei sourcen; `.zshrc` hängt zusätzlich `precmd_functions+=(__dmws_cwd)` an.
  Dies ist das etablierte Muster (VS Code Shell Integration). Kein Echo, robust gegen
  Login-Shell-Reihenfolge.
- **PowerShell (Windows):** unverändert — der `-Command`-Bootstrap echoed bereits nicht.

Die Integrations-Startdateien werden einmalig beim App-Start generiert (idempotent
geschrieben), nicht pro Pane.

### Tests

- Hook-Generierung (Inhalt der zsh-Forwarding-Dateien, bash-`PROMPT_COMMAND`-String) als
  pure Funktionen unit-getestet.
- Manuelle Verifikation: frischer Pane zeigt **keinen** `__dmws_cwd`-Befehl; Pane-Titel
  aktualisiert sich weiterhin auf das aktuelle Verzeichnis (cwd-Reporting intakt).

---

## Reihenfolge der Umsetzung

A → C → B (A ist isoliert und liefert sofort sichtbaren Nutzen; C beseitigt eine
Müllquelle, bevor B den Replay umstellt; B baut auf sauberem Output auf).

## Nicht im Scope

- Wiederbeleben der eigentlichen PTY-Prozesse über Neustart hinweg (bleibt: frische Shell,
  nur visuelle Historie).
- Wiederherstellen des Alternate-Screen-Zustands laufender TUIs (codex/claude starten neu).
- Multi-Window-Bounds (App ist Single-Window).
