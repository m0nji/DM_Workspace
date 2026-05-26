# Session-Restore-Treue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beim App-Neustart sieht die wiederhergestellte Sitzung sauber aus — gleiche Fenstergröße wie zuletzt, lesbare Historie ohne Steuerzeichen-Müll, kein sichtbarer Shell-Hook.

**Architecture:** Drei unabhängige Bausteine. (A) Der Main-Prozess persistiert die Fenster-Bounds in `state.json` und wendet sie beim Erzeugen des Fensters an. (B) Der Renderer schneidet Scrollback nicht mehr als rohe PTY-Bytes mit, sondern serialisiert den gerenderten xterm-Puffer über `@xterm/addon-serialize`. (C) Der cwd-Hook wird ohne stdin-Echo injiziert — bash über die `PROMPT_COMMAND`-Umgebungsvariable, zsh über ein generiertes `ZDOTDIR`-Integrationsverzeichnis.

**Tech Stack:** Electron 30, React 18, xterm 5.5, node-pty, TypeScript, Vitest, Playwright (e2e).

---

## File Structure

**New files:**
- `src/main/window-bounds.ts` — `WindowBounds`-Hilfen: reine `isBoundsVisible()`-Clamp-Logik + `currentWindowBounds(win)` (liest Bounds aus einem `BrowserWindow`).
- `src/main/shell-integration.ts` — reine Generatoren für die shell-spezifische, echo-freie Hook-Injektion (bash `PROMPT_COMMAND`-Wert, zsh-Integrationsdateien) + `writeZshIntegrationDir()`.
- `tests/window-bounds.test.ts`
- `tests/shell-integration.test.ts`

**Modified files:**
- `src/shared/types.ts` — `WindowBounds`-Interface + optionales `AppState.windowBounds`.
- `src/main/persistence.ts` — `migrateWindowBounds()`; `windowBounds` durch `deserialize()` erhalten/validieren.
- `src/main/ipc.ts` — `registerIpc()` gibt `{ pty, persistWindowBounds, loadWindowBounds }` zurück; `state:save` überschreibt `windowBounds` mit dem echten Fensterzustand (Main ist autoritativ → Renderer kann nicht clobbern).
- `src/main/index.ts` — Bounds beim `createWindow()` anwenden; Fenster-Events (`resize`/`move`/`maximize`/`unmaximize`) debounced persistieren.
- `src/main/pty-manager.ts` — stdin-Injektion des Hooks durch env/`ZDOTDIR`-basierte Injektion ersetzen.
- `src/renderer/components/TerminalView.tsx` — `SerializeAddon` statt Roh-Byte-Capture.
- `package.json` — Dependency `@xterm/addon-serialize`.

---

## Task 1: WindowBounds-Typ + Persistenz

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/persistence.ts`
- Test: `tests/persistence.test.ts`

- [ ] **Step 1: Typ ergänzen**

In `src/shared/types.ts` direkt vor `export interface AppState` einfügen:

```ts
export interface WindowBounds {
  x?: number;          // fehlt => beim Start zentrieren
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}
```

Und `AppState` um das optionale Feld erweitern (Feld nach `settings` einfügen):

```ts
export interface AppState {
  version: 1;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  settings: Settings;
  windowBounds?: WindowBounds; // vom Main-Prozess verwaltet; fehlt beim Erststart
}
```

- [ ] **Step 2: Failing test schreiben**

In `tests/persistence.test.ts` am Ende des `describe('persistence serialize/deserialize', ...)`-Blocks ergänzen. Den Import-Hinweis beachten: `migrateWindowBounds` aus `'../src/main/persistence'` mitimportieren (Import-Zeile oben entsprechend erweitern).

```ts
  it('round-trips windowBounds through serialize/deserialize', () => {
    const withBounds: AppState = {
      ...sample,
      windowBounds: { x: 100, y: 120, width: 1600, height: 1000, isMaximized: false }
    };
    expect(deserialize(serialize(withBounds))).toEqual(withBounds);
  });

  it('drops malformed windowBounds but keeps the rest of the state', () => {
    const result = deserialize(JSON.stringify({
      version: 1,
      activeWorkspaceId: 'w1',
      workspaces: [],
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      windowBounds: { width: 'oops' } // ungültig
    }));
    expect(result.windowBounds).toBeUndefined();
    expect(result.activeWorkspaceId).toBe('w1');
    expect(result.workspaces).toEqual([]);
  });

  it('preserves a maximized windowBounds flag', () => {
    expect(migrateWindowBounds({ width: 800, height: 600, isMaximized: true }))
      .toEqual({ width: 800, height: 600, isMaximized: true });
  });

  it('returns undefined for non-object windowBounds', () => {
    expect(migrateWindowBounds(undefined)).toBeUndefined();
    expect(migrateWindowBounds(null)).toBeUndefined();
    expect(migrateWindowBounds(42)).toBeUndefined();
  });
```

- [ ] **Step 3: Test ausführen → fehlschlägt**

Run: `npm test -- persistence`
Expected: FAIL — `migrateWindowBounds` ist nicht exportiert / nicht definiert.

- [ ] **Step 4: Implementierung**

In `src/main/persistence.ts` den Typ-Import erweitern und die Migrationsfunktion ergänzen sowie `deserialize()` anpassen.

Import-Zeile (oben) erweitern:

```ts
import type { AppState, Settings, WindowBounds } from '../shared/types';
```

Neue Funktion (nach `migrateSettings`):

```ts
// Validate a persisted windowBounds blob. width/height/isMaximized are required;
// x/y are optional (absent => the window is centered on next launch). Returns
// undefined for any malformed input so a bad value never blocks loading the rest.
export function migrateWindowBounds(raw: unknown): WindowBounds | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r.width !== 'number' || typeof r.height !== 'number') return undefined;
  if (typeof r.isMaximized !== 'boolean') return undefined;
  const out: WindowBounds = { width: r.width, height: r.height, isMaximized: r.isMaximized };
  if (typeof r.x === 'number' && typeof r.y === 'number') { out.x = r.x; out.y = r.y; }
  return out;
}
```

`deserialize()` anpassen, sodass `windowBounds` validiert mitgenommen (und Ungültiges entfernt) wird:

```ts
export function deserialize(json: string): AppState {
  try {
    const parsed = JSON.parse(json);
    if (!isValid(parsed)) return defaultState();
    // Migrate persisted settings to the current shape.
    const out: AppState = { ...parsed, settings: migrateSettings(parsed.settings) };
    const wb = migrateWindowBounds((parsed as Record<string, unknown>).windowBounds);
    if (wb) out.windowBounds = wb; else delete out.windowBounds;
    return out;
  } catch {
    return defaultState();
  }
}
```

- [ ] **Step 5: Test ausführen → besteht**

Run: `npm test -- persistence`
Expected: PASS (alle bestehenden + neuen Fälle).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/persistence.ts tests/persistence.test.ts
git commit -m "feat: persist window bounds in app state"
```

---

## Task 2: Reine Bounds-Sichtbarkeitslogik

**Files:**
- Create: `src/main/window-bounds.ts`
- Test: `tests/window-bounds.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `tests/window-bounds.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isBoundsVisible, type DisplayRect } from '../src/main/window-bounds';

const main: DisplayRect = { x: 0, y: 0, width: 1920, height: 1080 };

describe('isBoundsVisible', () => {
  it('returns true when the window sits well inside a display', () => {
    expect(isBoundsVisible({ x: 100, y: 100, width: 800, height: 600, isMaximized: false }, [main])).toBe(true);
  });

  it('returns false when the window is entirely off all displays', () => {
    expect(isBoundsVisible({ x: 5000, y: 5000, width: 800, height: 600, isMaximized: false }, [main])).toBe(false);
  });

  it('returns false when only a sliver (<50px) overlaps a display', () => {
    expect(isBoundsVisible({ x: 1900, y: 100, width: 800, height: 600, isMaximized: false }, [main])).toBe(false);
  });

  it('returns false when x/y are absent (no saved position)', () => {
    expect(isBoundsVisible({ width: 800, height: 600, isMaximized: false }, [main])).toBe(false);
  });

  it('returns true when overlapping a secondary display', () => {
    const second: DisplayRect = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(isBoundsVisible({ x: 2000, y: 100, width: 800, height: 600, isMaximized: false }, [main, second])).toBe(true);
  });
});
```

- [ ] **Step 2: Test ausführen → fehlschlägt**

Run: `npm test -- window-bounds`
Expected: FAIL — Modul `src/main/window-bounds.ts` existiert nicht.

- [ ] **Step 3: Implementierung**

Create `src/main/window-bounds.ts`:

```ts
import type { BrowserWindow } from 'electron';
import type { WindowBounds } from '../shared/types';

// A display rectangle in screen coordinates (matches Electron's Display.bounds).
export interface DisplayRect { x: number; y: number; width: number; height: number; }

// True if the saved bounds overlap at least one display by a usable margin.
// Requires both x and y to be present — a window with no saved position is
// considered "not visible" so the caller centers it instead.
const MIN_VISIBLE = 50; // px that must overlap a display in each axis
export function isBoundsVisible(b: WindowBounds, displays: DisplayRect[]): boolean {
  if (b.x === undefined || b.y === undefined) return false;
  const x = b.x, y = b.y;
  return displays.some((d) => {
    const ix = Math.max(x, d.x);
    const iy = Math.max(y, d.y);
    const ax = Math.min(x + b.width, d.x + d.width);
    const ay = Math.min(y + b.height, d.y + d.height);
    return (ax - ix) >= MIN_VISIBLE && (ay - iy) >= MIN_VISIBLE;
  });
}

// Snapshot a window's restorable bounds. When maximized, getNormalBounds()
// returns the pre-maximize rectangle so the un-maximized size is correct after
// restore; isMaximized is stored separately so the window re-maximizes on launch.
export function currentWindowBounds(win: BrowserWindow): WindowBounds {
  const isMaximized = win.isMaximized();
  const b = isMaximized ? win.getNormalBounds() : win.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized };
}
```

- [ ] **Step 4: Test ausführen → besteht**

Run: `npm test -- window-bounds`
Expected: PASS (5 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/window-bounds.ts tests/window-bounds.test.ts
git commit -m "feat: window-bounds visibility helper"
```

---

## Task 3: Bounds im Main-Prozess anwenden & persistieren

**Files:**
- Modify: `src/main/ipc.ts`
- Modify: `src/main/index.ts`

Hinweis: Diese Verdrahtung berührt das echte `BrowserWindow` und wird über Build + manuelle/e2e-Verifikation (Task 8) geprüft, nicht über Unit-Tests.

- [ ] **Step 1: `registerIpc` gibt Bounds-Helfer zurück**

In `src/main/ipc.ts` die Imports erweitern:

```ts
import { loadStateFromFile, saveStateToFile } from './persistence';
import { currentWindowBounds } from './window-bounds';
import type { WindowBounds } from '../shared/types';
```

Den `state:save`-Handler so ändern, dass der Main die Bounds autoritativ setzt (der Renderer schickt den restlichen State, kennt aber den aktuellen Fensterzustand nicht):

```ts
  ipcMain.handle('state:save', (_e, state: AppState) => {
    const win = getWindow();
    if (win) state.windowBounds = currentWindowBounds(win);
    saveStateToFile(STATE_FILE(), state);
    // Drop scrollback for panes that no longer exist in any layout (closed panes).
    const liveIds = state.workspaces.flatMap((w) => collectPaneIds(w.layout));
    scrollback.prune(liveIds);
  });
```

Am Ende von `registerIpc`, statt `return pty;`, einen Helfer-Verbund zurückgeben:

```ts
  // Read-modify-write only the windowBounds field so a bounds update never races
  // away the renderer-owned parts of the state (and vice versa).
  function persistWindowBounds(win: BrowserWindow): void {
    const state = loadStateFromFile(STATE_FILE());
    state.windowBounds = currentWindowBounds(win);
    saveStateToFile(STATE_FILE(), state);
  }

  function loadWindowBounds(): WindowBounds | undefined {
    return loadStateFromFile(STATE_FILE()).windowBounds;
  }

  return { pty, persistWindowBounds, loadWindowBounds };
```

(`BrowserWindow` ist bereits aus `'electron'` importiert.)

- [ ] **Step 2: `index.ts` an die neue Rückgabe anpassen + Bounds anwenden**

In `src/main/index.ts`:

Import ergänzen:

```ts
import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { isBoundsVisible } from './window-bounds';
```

Die Zeile `const pty = registerIpc(() => mainWindow);` ersetzen durch:

```ts
const ipc = registerIpc(() => mainWindow);
```

Beide `pty.killAll()`-Aufrufe (in `window-all-closed` und `before-quit`) zu `ipc.pty.killAll()` ändern.

In `createWindow()` vor dem `new BrowserWindow({...})` die gespeicherten Bounds laden und Größe/Position berechnen:

```ts
  // Restore last-used window size/position. width/height always apply; x/y only
  // if the saved frame still overlaps a connected display (a disconnected monitor
  // would otherwise open the window off-screen) — otherwise the window is centered.
  const saved = ipc.loadWindowBounds();
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const usePos = saved ? isBoundsVisible(saved, displays) : false;
```

Im `BrowserWindow`-Konstruktor `width`/`height` aus `saved` beziehen und `x`/`y` nur bei `usePos` setzen:

```ts
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    ...(usePos ? { x: saved!.x, y: saved!.y } : {}),
    show: false, // shown on ready-to-show to avoid a blank flash during load
    icon: iconPath,
    // ... (restliche Optionen unverändert)
```

Den `ready-to-show`-Handler erweitern, sodass ein zuletzt maximiertes Fenster wieder maximiert öffnet:

```ts
  mainWindow.once('ready-to-show', () => {
    if (saved?.isMaximized) mainWindow?.maximize();
    mainWindow?.show();
  });
```

- [ ] **Step 3: Fenster-Events debounced persistieren**

Am Ende von `createWindow()` (nach den bestehenden `focus`/`blur`-Handlern) einfügen:

```ts
  // Persist size/position shortly after the user stops dragging/resizing, and
  // immediately on (un)maximize. Debounced so a resize drag writes once, not per frame.
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleBoundsSave = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      if (mainWindow) ipc.persistWindowBounds(mainWindow);
    }, 500);
  };
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('maximize', () => mainWindow && ipc.persistWindowBounds(mainWindow));
  mainWindow.on('unmaximize', () => mainWindow && ipc.persistWindowBounds(mainWindow));
```

- [ ] **Step 4: Typecheck + Build**

Run: `npm run typecheck`
Expected: keine Fehler.

Run: `npm run build`
Expected: Build erfolgreich.

- [ ] **Step 5: Manuelle Verifikation**

Run: `npm run dev`
Schritte: Fenster auf eine deutlich andere Größe ziehen → App beenden → erneut `npm run dev`.
Expected: Fenster öffnet in der zuletzt eingestellten Größe/Position. Maximieren → beenden → starten: öffnet maximiert.

- [ ] **Step 6: Commit**

```bash
git add src/main/ipc.ts src/main/index.ts
git commit -m "feat: restore window size/position on launch"
```

---

## Task 4: Shell-Integration ohne Echo (reine Generatoren)

**Files:**
- Create: `src/main/shell-integration.ts`
- Test: `tests/shell-integration.test.ts`

- [ ] **Step 1: Failing test schreiben**

Create `tests/shell-integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bashPromptCommand, zshIntegrationFiles } from '../src/main/shell-integration';

describe('bashPromptCommand', () => {
  it('emits an OSC 7 file:// sequence using $HOSTNAME and $PWD', () => {
    const pc = bashPromptCommand();
    expect(pc).toContain(']7;file://');
    expect(pc).toContain('$HOSTNAME');
    expect(pc).toContain('$PWD');
    // raw ESC + BEL, not the escaped \e/\a literals (env vars are not shell-parsed)
    expect(pc).toContain('\x1b');
    expect(pc).toContain('\x07');
  });
});

describe('zshIntegrationFiles', () => {
  const dir = '/tmp/dmws-int';
  const files = zshIntegrationFiles(dir);

  it('produces the four zsh startup files', () => {
    expect(Object.keys(files).sort()).toEqual(['.zlogin', '.zprofile', '.zshenv', '.zshrc']);
  });

  it('.zshrc sources the user file and registers the precmd hook', () => {
    expect(files['.zshrc']).toContain('_DMWS_USER_ZDOTDIR');
    expect(files['.zshrc']).toContain('precmd_functions+=(__dmws_cwd)');
    expect(files['.zshrc']).toContain(']7;file://');
  });

  it('.zshenv re-pins ZDOTDIR to the integration dir after sourcing the user file', () => {
    expect(files['.zshenv']).toContain(`ZDOTDIR='${dir}'`);
  });

  it('each file sources only its matching user startup file', () => {
    expect(files['.zprofile']).toContain('.zprofile');
    expect(files['.zlogin']).toContain('.zlogin');
    expect(files['.zprofile']).not.toContain('.zshrc');
  });
});
```

- [ ] **Step 2: Test ausführen → fehlschlägt**

Run: `npm test -- shell-integration`
Expected: FAIL — Modul existiert nicht.

- [ ] **Step 3: Implementierung**

Create `src/main/shell-integration.ts`:

```ts
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Raw control bytes for the OSC 7 cwd report. ESC ] 7 ; file://HOST PATH BEL.
const ESC = '\x1b';
const BEL = '\x07';

// bash: the cwd-reporting command goes into the PROMPT_COMMAND *environment
// variable*, which bash runs before each prompt. Inheriting it via env avoids
// echoing a typed command into the terminal (the old stdin-injection did).
// $HOSTNAME/$PWD are expanded by bash at prompt time, so they stay as literals
// here; the ESC/BEL are raw bytes (env values are not shell-parsed).
export function bashPromptCommand(): string {
  return `printf '${ESC}]7;file://%s%s${BEL}' "$HOSTNAME" "$PWD"`;
}

// zsh has no equivalent env hook, so we point ZDOTDIR at a generated dir holding
// forwarding startup files. Each forwards to the user's real startup file (under
// _DMWS_USER_ZDOTDIR, set in the spawn env); .zshrc additionally registers the
// precmd hook. .zshenv re-pins ZDOTDIR to our dir *after* sourcing the user's
// .zshenv, so a user .zshenv that changes ZDOTDIR can't divert the later files.
// The integration dir path is embedded as a literal because we generate the file.
export function zshIntegrationFiles(dir: string): Record<string, string> {
  const source = (name: string) =>
    `[ -f "$_DMWS_USER_ZDOTDIR/${name}" ] && . "$_DMWS_USER_ZDOTDIR/${name}"\n`;
  return {
    '.zshenv': source('.zshenv') + `ZDOTDIR='${dir}'\n`,
    '.zprofile': source('.zprofile'),
    '.zshrc':
      source('.zshrc') +
      `__dmws_cwd(){ printf '${ESC}]7;file://%s%s${BEL}' "$HOST" "$PWD"; }\n` +
      `precmd_functions+=(__dmws_cwd)\n`,
    '.zlogin': source('.zlogin')
  };
}

// Write the zsh integration files into `dir` (created if needed) and return the
// dir. Idempotent — safe to call once per app launch.
export function writeZshIntegrationDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const files = zshIntegrationFiles(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}
```

- [ ] **Step 4: Test ausführen → besteht**

Run: `npm test -- shell-integration`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/shell-integration.ts tests/shell-integration.test.ts
git commit -m "feat: echo-free shell cwd-hook generators"
```

---

## Task 5: Hook-Injektion im PtyManager umstellen

**Files:**
- Modify: `src/main/pty-manager.ts`
- Test: `tests/pty-manager.test.ts`

Hinweis: Der bash-Pfad nutzt jetzt die `PROMPT_COMMAND`-env-Variable; eine User-`.bashrc`, die `PROMPT_COMMAND` selbst überschreibt, würde die cwd-Meldung für bash deaktivieren (Trade-off gegen das Echo). zsh ist über die ZDOTDIR-Dateien robust. PowerShell bleibt unverändert.

- [ ] **Step 1: Failing test schreiben**

In `tests/pty-manager.test.ts` einen Test ergänzen, der prüft, dass beim Spawn **kein** `__dmws_cwd`-Befehl mehr in den Output echot wird (die ZDOTDIR-/env-Injektion erzeugt keine sichtbare Befehlszeile). Innerhalb des `suite(...)`-Blocks:

```ts
  it('does not echo the cwd hook definition into the terminal output', async () => {
    const PtyManager = PtyManagerCtor!;
    const mgr = new PtyManager();
    const chunks: string[] = [];
    mgr.onData((paneId, data) => { if (paneId === 'p3') chunks.push(data); });
    mgr.spawn('p3', { cwd: process.cwd(), cols: 80, rows: 24 });
    // give the shell time to start and print its first prompt
    await new Promise((r) => setTimeout(r, 1500));
    expect(chunks.join('')).not.toContain('__dmws_cwd(){');
    mgr.kill('p3');
  });
```

- [ ] **Step 2: Test ausführen → fehlschlägt (falls node-pty unter Node lädt)**

Run: `npm test -- pty-manager`
Expected: FAIL mit gefundenem `__dmws_cwd(){` im Output — ODER `describe.skip`, falls node-pty unter Vitest nicht lädt (dann wird dieser Pfad über die e2e/manuelle Verifikation in Task 8 abgedeckt; weiter mit Step 3).

- [ ] **Step 3: Implementierung**

In `src/main/pty-manager.ts` die `posixCwdHook`-Funktion und die stdin-Injektion entfernen und durch env/ZDOTDIR-basierte Injektion ersetzen.

Imports oben ergänzen:

```ts
import { app } from 'electron';
import { join } from 'path';
import { bashPromptCommand, writeZshIntegrationDir } from './shell-integration';
```

`PS_CWD_BOOTSTRAP` und `shellArgs()` bleiben. Den gesamten Block von `// POSIX cwd reporting:` bis zum Ende von `posixCwdHook(...)` **löschen**.

Eine Hilfsfunktion ergänzen, die die spawn-Umgebung pro Shell baut:

```ts
// Build the spawn env for the cwd-reporting hook without echoing anything into
// the terminal: bash inherits PROMPT_COMMAND; zsh gets ZDOTDIR pointed at the
// generated integration dir (with _DMWS_USER_ZDOTDIR preserving the original).
function cwdHookEnv(shell: string): Record<string, string> {
  const base = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>;
  if (process.platform === 'win32') return base;
  if (/zsh$/.test(shell)) {
    const dir = writeZshIntegrationDir(join(app.getPath('userData'), 'shell-integration', 'zsh'));
    base._DMWS_USER_ZDOTDIR = process.env.ZDOTDIR || process.env.HOME || '';
    base.ZDOTDIR = dir;
    return base;
  }
  // bash / other POSIX shells
  base.PROMPT_COMMAND = bashPromptCommand();
  return base;
}
```

`spawn()` anpassen: `env` aus `cwdHookEnv(shell)` beziehen und die nachträgliche `proc.write(...)`-Injektion entfernen:

```ts
  spawn(paneId: string, opts: SpawnOptions): void {
    if (this.procs.has(paneId)) return;
    const shell = opts.shell || defaultShell();
    const proc = pty.spawn(shell, shellArgs(), {
      // xterm-256color + COLORTERM=truecolor so programs render full color (e.g.
      // Claude Code's logo shows orange instead of the 16-color red fallback).
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: resolveCwd(opts.cwd),
      env: cwdHookEnv(shell)
    });
    proc.onData((data) => this.dataListeners.forEach((l) => l(paneId, data)));
    proc.onExit(({ exitCode }) => {
      this.procs.delete(paneId);
      this.exitListeners.forEach((l) => l(paneId, exitCode));
    });
    this.procs.set(paneId, proc);
  }
```

- [ ] **Step 4: Test ausführen → besteht**

Run: `npm test -- pty-manager`
Expected: PASS (oder skip, falls node-pty unter Node nicht lädt).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler (insb. `posixCwdHook` ist vollständig entfernt, keine toten Referenzen).

- [ ] **Step 6: Commit**

```bash
git add src/main/pty-manager.ts tests/pty-manager.test.ts
git commit -m "feat: inject cwd hook via env/ZDOTDIR instead of stdin echo"
```

---

## Task 6: SerializeAddon-Dependency hinzufügen

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Dependency installieren**

Run: `npm install @xterm/addon-serialize@^0.13.0`
Expected: `@xterm/addon-serialize` erscheint unter `dependencies` in `package.json`; Installation ohne Peer-Konflikt zu `@xterm/xterm@5.5.0`.

- [ ] **Step 2: Verifizieren**

Run: `cat node_modules/@xterm/addon-serialize/package.json | grep '"version"'`
Expected: eine `0.13.x`-Version.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @xterm/addon-serialize"
```

---

## Task 7: Scrollback über SerializeAddon

**Files:**
- Modify: `src/renderer/components/TerminalView.tsx`

Hinweis: Der Effekt (sauberer Replay) ist xterm-Integrationsverhalten und wird über Build + manuelle/e2e-Verifikation in Task 8 geprüft.

- [ ] **Step 1: Addon importieren & laden**

In `src/renderer/components/TerminalView.tsx` den Import ergänzen (nach dem `SearchAddon`-Import):

```ts
import { SerializeAddon } from '@xterm/addon-serialize';
```

Innerhalb des `useEffect`, nach dem Laden von `search`, das Addon laden:

```ts
    const serializeAddon = new SerializeAddon();
    term.loadAddon(serializeAddon);
```

- [ ] **Step 2: Roh-Capture durch Serialisierung ersetzen**

Den Capture-Block (`const MAX_BUFFER = ...` bis Ende von `const capture = ...`) ersetzen durch eine serialize-basierte Speicherung. Begründungs-Kommentar beibehalten:

```ts
    // Persist the *rendered* terminal buffer (text + colors) rather than the raw
    // PTY byte stream. SerializeAddon emits only the normal buffer — no alt-screen
    // contents, color-query replies, or cursor-jump sequences — so a restart
    // replays clean, reflowable history instead of control-character garbage.
    // Cap the exported scrollback so scrollback.json can't grow without bound.
    const SCROLLBACK_LINES = 1000;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const doSave = (): void => {
      window.api.saveScrollback(paneId, serializeAddon.serialize({ scrollback: SCROLLBACK_LINES }));
    };
    const flushSave = (): void => {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      doSave();
    };
    const scheduleSave = (): void => {
      if (saveTimer) return; // coalesce bursts of output into one write per second
      saveTimer = setTimeout(() => { saveTimer = null; doSave(); }, 1000);
    };
```

- [ ] **Step 3: `onData` anpassen**

Den `onData`-Handler so ändern, dass er statt `capture(data)` den (debounced) Save plant:

```ts
    const offData = window.api.onData(paneId, (data) => {
      term.write(data, updateAtBottom);
      scheduleSave();
      activity.onOutput();
    });
```

- [ ] **Step 4: Replay anpassen**

Im `restoreOnce()` die Zeile `buffer = saved;` entfernen (es gibt keinen `buffer` mehr). Der replay schreibt den gespeicherten serialisierten Text und den Marker wie bisher:

```ts
    const restoreOnce = (): Promise<void> => {
      if (!restorePromise) {
        restorePromise = window.api.getScrollback(paneId).then((saved) => {
          if (saved) {
            term.write(saved);
            term.write('\r\n\x1b[2m── vorherige Sitzung wiederhergestellt (Prozess neu gestartet) ──\x1b[0m\r\n');
          }
        });
      }
      return restorePromise;
    };
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler (keine verbleibenden Referenzen auf `buffer`, `MAX_BUFFER` oder `capture`).

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: Build erfolgreich.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/TerminalView.tsx
git commit -m "feat: serialize terminal buffer for clean scrollback restore"
```

---

## Task 8: Gesamtverifikation

**Files:** keine (Verifikation)

- [ ] **Step 1: Volle Testsuite**

Run: `npm test`
Expected: alle Tests grün.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: keine Fehler.

- [ ] **Step 3: e2e (falls vorhanden/relevant)**

Run: `npm run e2e`
Expected: bestehende Persistenz-/Layout-e2e-Tests grün (kein Regress).

- [ ] **Step 4: Manuelle End-to-End-Prüfung**

Run: `npm run dev`
Schritte:
1. Mehrere Panes öffnen, in einem ein interaktives TUI laufen lassen (z. B. `claude` oder `codex`), in anderen normalen Shell-Output erzeugen.
2. Beobachten: frischer Pane zeigt **keinen** `__dmws_cwd(){…}`-Befehl mehr; Pane-Titel zeigt das aktuelle Verzeichnis (cwd-Reporting funktioniert).
3. Fenster auf eine eigene Größe bringen (oder maximieren). App beenden, neu starten.
4. Beobachten: Fenster öffnet in derselben Größe/Position; wiederhergestellte Historie ist lesbar, **keine** `^[]10;rgb…`-/Steuerzeichen-Fragmente, kein zerschossenes Layout wie im Ausgangs-Screenshot.

- [ ] **Step 5: Abschluss**

Wenn alles grün/sauber ist, ist die Implementierung vollständig. (Branch-Integration über die `superpowers:finishing-a-development-branch`-Skill anbieten.)
```
