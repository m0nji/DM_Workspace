import { randomBytes } from 'node:crypto';
import * as pty from 'node-pty';
import { killAndWait } from './pty-shutdown';
import { existsSync, accessSync, constants, statSync } from 'fs';
import { resolveCwd } from './resolve-cwd';
import { app } from 'electron';
import { join, isAbsolute } from 'path';
import { bashPromptCommand, shellArgs, writeZshIntegrationDir, writeScreenIntegration } from './shell-integration';
import { promptNonce } from './prompt-nonce';
import type { TerminalBackend, TerminalDataListener, TerminalExitListener } from './terminal-backend';
import type { SpawnTarget } from '../shared/types';

export interface SpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  shell?: string;
  // Ausgewertet vom BackendRouter (terminal-backend.ts), nicht vom PtyManager:
  // der ist immer das lokale Backend und ignoriert das Feld.
  target?: SpawnTarget;
}

// Windows PowerShell 5.1 is bound to PSReadLine 2.0.0, whose
// RecomputeInitialCoords recalculates the input column as
// `_initialX % BufferWidth` on every console size change — once the pty has
// been narrower than the prompt is long, the column stays wrong for good.
// PowerShell 7 ships PSReadLine >= 2.2 with that method rewritten, so
// preferring pwsh removes the cause instead of healing the symptom (see
// docs/superpowers/plans/2026-08-22-psreadline-initialx-fix.md).
//
// PATH is scanned directly rather than shelling out to `where.exe`: a handful
// of existsSync calls cost microseconds where a child process costs tens of
// milliseconds, and nothing can hang, fail, or need a shell of its own.
export function resolveWindowsShell(
  pathEnv: string | undefined,
  exists: (file: string) => boolean = existsSync
): string {
  try {
    for (const entry of (pathEnv ?? '').split(';')) {
      // PATH entries may be quoted and may carry stray whitespace.
      const dir = entry.trim().replace(/^"(.*)"$/, '$1');
      if (dir === '') continue;
      const candidate = join(dir, 'pwsh.exe');
      if (exists(candidate)) return candidate;
    }
  } catch {
    // A malformed PATH must never be the reason a pane cannot start.
  }
  return 'powershell.exe';
}

// OFFEN, bewusst zurückgestellt (22.08.2026): ein Opt-out für diesen Vorzug.
// Heute ist die Wahl wirkungslos, solange kein pwsh installiert ist — sie wird
// aber schlagartig für ALLE Windows-Panes scharf, sobald jemand PowerShell 7
// installiert, ohne dass an der App etwas getan wurde. pwsh liest ein anderes
// $PROFILE (Documents\PowerShell\ statt Documents\WindowsPowerShell\), hat
// einen anderen Modulsatz und eine andere .NET-Basis; wiederhergestellte
// Sessions wachen dann in einer anderen Shell auf. Der abgestimmte Schnitt,
// falls das gebaut wird: Setting `shell` mit „automatisch / powershell / pwsh /
// eigener Pfad", Default „automatisch" — also genau das, was defaultShell()
// hier tut. Die Verdrahtung steht bereits, SpawnOptions.shell wird respektiert;
// es fehlt nur jemand, der es setzt. Nicht ungefragt umsetzen.
//
// defaultShell runs on every spawn, so the lookup happens once per process —
// same reasoning as ensureZshIntegrationDir / ensureScreenrc below.
let win32Shell: string | null = null;
function defaultShell(): string {
  if (process.platform === 'win32') {
    if (win32Shell === null) win32Shell = resolveWindowsShell(process.env.PATH);
    return win32Shell;
  }
  return process.env.SHELL || '/bin/zsh';
}

// The zsh integration files are deterministic, so generate them once per process
// instead of re-writing on every pane spawn (which would block the main thread).
let zshIntegrationDir: string | null = null;
function ensureZshIntegrationDir(): string {
  if (zshIntegrationDir === null) {
    zshIntegrationDir = writeZshIntegrationDir(join(app.getPath('userData'), 'shell-integration', 'zsh'), promptNonce());
  }
  return zshIntegrationDir;
}

// Generate the managed screenrc once per process (see screenrcContent for why).
// We forward whichever screenrc screen would otherwise read on its own — an
// inherited $SCREENRC if set, else ~/.screenrc — but only when it exists, so we
// never emit a `source` of a missing file (which screen would warn about).
let screenrcPath: string | null = null;
function ensureScreenrc(): string {
  if (screenrcPath === null) {
    const inherited = process.env.SCREENRC;
    const userRc =
      inherited && existsSync(inherited)
        ? inherited
        : process.env.HOME
          ? join(process.env.HOME, '.screenrc')
          : '';
    const forward = userRc && existsSync(userRc) ? userRc : null;
    screenrcPath = writeScreenIntegration(join(app.getPath('userData'), 'shell-integration', 'screen'), forward);
  }
  return screenrcPath;
}

function inheritedUserZdotdir(integrationDir: string): string {
  const inherited = process.env.ZDOTDIR || '';
  if (inherited === integrationDir || /[/\\]shell-integration[/\\]zsh$/.test(inherited)) {
    return process.env._DMWS_USER_ZDOTDIR || process.env.HOME || '';
  }
  return inherited || process.env.HOME || '';
}

// Build the spawn env for the cwd-reporting hook without echoing anything into
// the terminal: bash inherits PROMPT_COMMAND; zsh gets ZDOTDIR pointed at the
// generated integration dir (with _DMWS_USER_ZDOTDIR preserving the original).
function cwdHookEnv(shell: string): Record<string, string> {
  const base = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>;
  if (process.platform === 'win32') return base;
  // macOS's bundled GNU screen 4.00.03 chokes on the 21-char window TERM it
  // derives from xterm-256color; redirect it to a screenrc that uses the
  // 15-char screen-256color instead. Only screen reads $SCREENRC, so this is
  // inert for every other program.
  if (process.platform === 'darwin') base.SCREENRC = ensureScreenrc();
  if (/zsh$/.test(shell)) {
    const dir = ensureZshIntegrationDir();
    base._DMWS_USER_ZDOTDIR = inheritedUserZdotdir(dir);
    base.ZDOTDIR = dir;
    return base;
  }
  // bash / other POSIX shells — prepend our hook to any inherited PROMPT_COMMAND
  // rather than discarding it.
  const inherited = process.env.PROMPT_COMMAND;
  const hook = bashPromptCommand(promptNonce());
  base.PROMPT_COMMAND = inherited ? `${hook};${inherited}` : hook;
  return base;
}

// Das lokale Prozess-Backend: spawnt echte PTYs auf dieser Maschine. Die
// Oberfläche ist als TerminalBackend extrahiert (terminal-backend.ts), damit
// B2 ein Remote-Backend mit identischer Schnittstelle daneben stellen kann.
export class PtyManager implements TerminalBackend {
  private sessions = new Map<string, { shell: string; nonce: string }>();
  sessionInfo(paneId: string): { shell: string; nonce: string } | undefined { return this.sessions.get(paneId); }
  private procs = new Map<string, pty.IPty>();
  // Last size requested per pane — kept for panes that have no process yet, so
  // a resize arriving before the spawn survives instead of vanishing, and used
  // to drop resizes that wouldn't change anything. See resize().
  private dims = new Map<string, { cols: number; rows: number }>();
  private dataListeners: TerminalDataListener[] = [];
  private exitListeners: TerminalExitListener[] = [];

  onData(cb: TerminalDataListener): void { this.dataListeners.push(cb); }
  onExit(cb: TerminalExitListener): void { this.exitListeners.push(cb); }

  spawn(paneId: string, opts: SpawnOptions): void {
    if (this.procs.has(paneId)) return;
    const shell = opts.shell || defaultShell();
    // POSIX node-pty can create its helper successfully and report a missing
    // executable only as a later exit. Fail before acknowledging the spawn so
    // the renderer keeps a template's one-shot command available for retry.
    if (process.platform !== 'win32' && isAbsolute(shell)) {
      accessSync(shell, constants.X_OK);
      if (!statSync(shell).isFile()) throw new Error(`Shell is not a file: ${shell}`);
    }
    const nonce = randomBytes(32).toString('hex');
    const proc = pty.spawn(shell, shellArgs(shell, promptNonce()), {
      // xterm-256color + COLORTERM=truecolor so programs render full color (e.g.
      // Claude Code's logo shows orange instead of the 16-color red fallback).
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: resolveCwd(opts.cwd),
      env: { ...cwdHookEnv(shell), DMWS_AGENT_NONCE: nonce }
    });
    proc.onData((data) => this.dataListeners.forEach((l) => l(paneId, data)));
    proc.onExit(({ exitCode }) => {
      this.procs.delete(paneId);
      this.sessions.delete(paneId);
      this.dims.delete(paneId);
      this.exitListeners.forEach((l) => l(paneId, exitCode));
    });
    this.procs.set(paneId, proc);
    this.sessions.set(paneId, { shell, nonce });
    // A resize for a pane that had no process yet was remembered instead of
    // dropped (see resize). Apply it now, so a pane whose resize overtook its
    // spawn doesn't keep running at the size it was spawned with — the shell
    // would print its prompt at a width the terminal no longer has.
    const pending = this.dims.get(paneId);
    this.dims.set(paneId, { cols: opts.cols, rows: opts.rows });
    if (pending && (pending.cols !== opts.cols || pending.rows !== opts.rows)) {
      this.resize(paneId, pending.cols, pending.rows);
    }
  }

  write(paneId: string, data: string): void {
    this.procs.get(paneId)?.write(data);
  }

  // Every settled layout change forwards the pane's current dimensions, so the
  // same size arrives repeatedly (re-focus, a height-only drag that doesn't
  // change the column count, a flush after a programmatic relayout). Passing
  // that on costs a SIGWINCH that makes TUIs repaint for nothing, so only real
  // changes reach the pty. Panes without a process keep the size anyway —
  // spawn() picks it up.
  resize(paneId: string, cols: number, rows: number): void {
    const last = this.dims.get(paneId);
    if (last && last.cols === cols && last.rows === rows) return;
    this.dims.set(paneId, { cols, rows });
    this.procs.get(paneId)?.resize(cols, rows);
  }

  kill(paneId: string): void {
    const proc = this.procs.get(paneId);
    if (proc) {
      proc.kill();
      this.procs.delete(paneId);
      this.sessions.delete(paneId);
    }
    // Also drops a remembered size for a pane that never spawned, so a later
    // pane reusing the id doesn't inherit it.
    this.dims.delete(paneId);
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id);
  }

  // Kill every pty and wait for each to actually exit before resolving, so the
  // native addon is done calling back into JS before Electron tears the
  // environment down on quit. See pty-shutdown.ts for why this matters.
  killAllAndWait(timeoutMs = 1500): Promise<void> {
    const procs = [...this.procs.values()];
    this.procs.clear();
    this.sessions.clear();
    this.dims.clear();
    return killAndWait(procs, timeoutMs);
  }
}
