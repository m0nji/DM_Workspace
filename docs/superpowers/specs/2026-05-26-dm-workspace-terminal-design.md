# DM Workspace — Terminal-Multiplexer (Design / Spec)

**Datum:** 2026-05-26
**Status:** Freigegeben (Brainstorming abgeschlossen)

## Ziel

Cross-platform Desktop-Terminal-Anwendung im Stil von BridgeMinds *BridgeSpace*.
macOS zuerst, danach Windows — **eine gemeinsame Codebasis**. Kernfunktionen:

- **Welcome-Screen** pro Workspace zur Auswahl der Pane-Anzahl/-Anordnung (Presets).
- **Linke Sidebar** als Workspace-Manager: mehrere Workspaces, umschaltbar, umbenennbar.
- **Gekacheltes Pane-Raster** (Tiling) mit echten Shells.
- Fokus auf **maus-getriebener Bedienung**: Pane per Klick schließen, horizontal/vertikal
  splitten, Trennlinien per Maus resizen, Pane maximieren/wiederherstellen.

## Scope

**In Scope:** reiner Terminal-Multiplexer — jedes Pane ist eine echte System-Shell.
Keine eigene KI-Integration (Nutzer kann beliebige CLIs inkl. KI-Tools selbst starten).

**Out of Scope (v1):** eingebaute KI-Agenten, Shell-Auswahl-UI (v1 nutzt System-Default),
Themes/Customizing über den Default hinaus, Sync/Cloud.

## Bestätigtes Modell

- **Workspace** = umschaltbarer Sidebar-Eintrag; enthält ein gekacheltes Raster aus Panes.
  Badge = Anzahl Terminals. Umbenennbar. Eigenes Default-Arbeitsverzeichnis.
- **Pane** = eine Kachel = genau **ein** Terminal mit eigener Kopfzeile
  (Split horizontal / Split vertikal / Maximieren / Schließen).
- **"Tab" = Pane** (flaches Kachel-Modell wie BridgeSpace, **keine** verschachtelten
  Tab-Leisten pro Pane).
- Single App-Window mit Grid (nicht mehrere OS-Fenster).

## Tech-Stack

**Electron + xterm.js (WebGL) + node-pty.**

- Identischer Stack wie das VS-Code-Terminal → ausgereifteste Cross-Platform-Basis
  (macOS + Windows via ConPTY), minimaler plattformspezifischer Code, hohe Stabilität.
- Priorisiert nach Nutzerwunsch: **Performance, Stabilität, minimale macOS→Windows-Anpassung**.
- Verworfen: Tauri/Rust (weniger erprobtes Windows-PTY-Handling → mehr Risiko);
  native SwiftUI/WinUI (keine gemeinsame Codebasis).

## 1. Architektur & Prozessmodell

- **Main-Prozess (Node):** App-Lifecycle, Fenster, Persistenz, `PtyManager` — pro Pane ein
  PTY via `node-pty`, adressiert über `paneId`.
- **Renderer (UI):** Sidebar, Grid, Panes; jedes Pane eine `xterm.js`-Instanz (WebGL-Renderer).
- **IPC-Brücke:** schmale, typisierte API über `contextBridge`, **ohne** `nodeIntegration`.
  Kanäle: `pty:spawn`, `pty:data`, `pty:input`, `pty:resize`, `pty:kill`.
  Daten-Streaming PTY ↔ xterm über diese Kanäle.

## 2. Datenmodell & Persistenz

Serialisierbarer App-State als JSON in `app.getPath('userData')`.

```
AppState
 └─ workspaces: Workspace[]
     ├─ id, name, cwd            // Default-Arbeitsverzeichnis (Default = Home)
     └─ layout: LayoutNode       // Binärbaum für Tiling

LayoutNode =
 | { type: 'pane',  paneId }
 | { type: 'split', direction: 'h' | 'v', ratio, children: [LayoutNode, LayoutNode] }
```

- **Split-Baum** ist der Kern: Hinzufügen (horizontal/vertikal) fügt einen `split`-Knoten ein;
  Schließen entfernt einen Pane und **kollabiert den Elternknoten** (Nachbar reklamiert Platz).
- `ratio` speichert die Resize-Position der Trennlinie.
- Presets (1 / 2 nebeneinander / 2 übereinander / 4 als 2×2 / 8 als 2×4) erzeugen einen
  vordefinierten Baum.
- **Persistiert:** Struktur + Namen + cwd + ratios. Beim Start frische Shells im
  gespeicherten Layout (laufender Shell-Inhalt ist technisch nicht wiederherstellbar).

## 3. UI-Komponenten & Interaktionen

- **Sidebar:** Workspace-Liste, aktiver markiert, Badge = Pane-Anzahl.
  `+` = neuer Workspace; Doppelklick = umbenennen; `×`/Kontextmenü = löschen.
- **Welcome-Screen:** erscheint pro Workspace ohne Panes. Genau **5 Presets**:
  1 · 2 nebeneinander · 2 übereinander · 4 (2×2) · 8 (2×4). Keine freie Anzahl.
- **Pane:** Kopfzeile mit Titel (auto aus cwd/Prozess) + Buttons
  Split-horizontal, Split-vertikal, Maximieren/Wiederherstellen, Schließen. Body = xterm.js.
- **Resize:** ziehbare Splitter zwischen Panes (Maus) → schreibt `ratio` in den Baum,
  triggert `pty:resize` (xterm `fit`).
- **Maximieren:** blendet andere Panes temporär aus (Layout-Baum bleibt erhalten);
  Wiederherstellen kehrt zurück.
- **Letztes Pane geschlossen:** Workspace bleibt bestehen und zeigt wieder den Welcome-Screen.

## 4. Cross-Platform & Packaging

- Eine Codebasis. Build via `electron-builder` → `.dmg` (macOS, **signiert mit Developer ID
  Application + notarisiert** über den bestehenden Apple-Developer-Account des Nutzers; Stapling
  des Tickets) und `.exe`/NSIS (Windows).
- Notarisierung läuft über einen `afterSign`-Hook (`@electron/notarize`); Credentials
  (Apple ID, app-spezifisches Passwort bzw. ASC-API-Key, Team ID) ausschließlich via
  Umgebungsvariablen, nie im Repo.
- node-pty wird pro Plattform als natives Modul gebaut.
- macOS zuerst; Windows-Build später ohne Code-Änderungen (ggf. nur Shell-Default + Pfad-Details).

## 5. Test-Strategie (TDD)

- **Unit (Schwerpunkt):** Layout-Baum (Split einfügen, Pane schließen + kollabieren,
  Ratio-Resize, Preset-Erzeugung) und Persistenz-Serialisierung — reine Logik, ohne UI testbar.
- **Integration:** `PtyManager` (spawn/data/kill) gegen echte Shell.
- **UI/E2E:** schmal (Playwright für Electron) — Smoke-Tests für Workspace-Wechsel, Split, Close.

## Annahmen

- Shell = System-Default (zsh auf macOS, PowerShell auf Windows). Keine Auswahl-UI in v1.
- Optik = dunkel, an BridgeSpace angelehnt. Feinschliff später (frontend-design).
