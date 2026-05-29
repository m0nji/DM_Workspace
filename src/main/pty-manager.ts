import * as pty from 'node-pty';
import { existsSync } from 'fs';
import { resolveCwd } from './resolve-cwd';
import { app } from 'electron';
import { join } from 'path';
import { bashPromptCommand, writeZshIntegrationDir, writeScreenIntegration } from './shell-integration';

export interface SpawnOptions {
  cwd: string;
  cols: number;
  rows: number;
  shell?: string;
}

function defaultShell(): string {
  if (process.platform === 'win32') return 'powershell.exe';
  return process.env.SHELL || '/bin/zsh';
}

// PowerShell bootstrap that makes every prompt emit OSC 9;9 with the current
// filesystem path, so the renderer can show the live cwd in the pane title. It
// wraps (rather than replaces) the existing prompt, so a custom prompt is kept.
// $([char]27) = ESC, $([char]7) = BEL (the OSC terminator). Passed as a single
// argv element, so no extra shell-quoting is needed.
const PS_CWD_BOOTSTRAP =
  "if(-not $global:__dmwsPrompt){$global:__dmwsPrompt=$function:prompt};" +
  "function global:prompt{$o=& $global:__dmwsPrompt;" +
  "\"$([char]27)]9;9;$($PWD.ProviderPath)$([char]7)$o\"}";

// Launch as a login shell on macOS/Linux so /etc/zprofile (path_helper) and the
// user's ~/.zprofile/.zlogin run — exactly like Terminal.app. Without this a
// GUI-launched app inherits only a minimal PATH and tools installed under e.g.
// /opt/homebrew/bin (Homebrew) aren't found, even though they work in Terminal.
function shellArgs(): string[] {
  if (process.platform === 'win32') return ['-NoExit', '-Command', PS_CWD_BOOTSTRAP];
  return ['-l'];
}

// The zsh integration files are deterministic, so generate them once per process
// instead of re-writing on every pane spawn (which would block the main thread).
let zshIntegrationDir: string | null = null;
function ensureZshIntegrationDir(): string {
  if (zshIntegrationDir === null) {
    zshIntegrationDir = writeZshIntegrationDir(join(app.getPath('userData'), 'shell-integration', 'zsh'));
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
  base.PROMPT_COMMAND = inherited ? `${bashPromptCommand()};${inherited}` : bashPromptCommand();
  return base;
}

type DataListener = (paneId: string, data: string) => void;
type ExitListener = (paneId: string, exitCode: number) => void;

export class PtyManager {
  private procs = new Map<string, pty.IPty>();
  private dataListeners: DataListener[] = [];
  private exitListeners: ExitListener[] = [];

  onData(cb: DataListener): void { this.dataListeners.push(cb); }
  onExit(cb: ExitListener): void { this.exitListeners.push(cb); }

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

  write(paneId: string, data: string): void {
    this.procs.get(paneId)?.write(data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    this.procs.get(paneId)?.resize(cols, rows);
  }

  kill(paneId: string): void {
    const proc = this.procs.get(paneId);
    if (proc) {
      proc.kill();
      this.procs.delete(paneId);
    }
  }

  killAll(): void {
    for (const id of [...this.procs.keys()]) this.kill(id);
  }
}
