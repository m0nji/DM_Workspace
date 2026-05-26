import * as pty from 'node-pty';
import { resolveCwd } from './resolve-cwd';

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

// POSIX cwd reporting: a precmd/PROMPT_COMMAND hook that prints OSC 7 with the
// current path on each prompt. Injected into the live shell after spawn (there
// is no clean env-var hook that works for both zsh and bash). \e = ESC, \a = BEL.
function posixCwdHook(shell: string): string {
  const emit = String.raw`printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"`;
  if (/zsh$/.test(shell)) {
    // zsh has no $HOSTNAME by default; use $HOST. precmd_functions runs each prompt.
    return `__dmws_cwd(){ printf '\\e]7;file://%s%s\\a' "$HOST" "$PWD"; }; precmd_functions+=(__dmws_cwd)`;
  }
  // bash and other POSIX shells: prepend to PROMPT_COMMAND.
  return `__dmws_cwd(){ ${emit}; }; PROMPT_COMMAND="__dmws_cwd;$PROMPT_COMMAND"`;
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
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string>
    });
    proc.onData((data) => this.dataListeners.forEach((l) => l(paneId, data)));
    proc.onExit(({ exitCode }) => {
      this.procs.delete(paneId);
      this.exitListeners.forEach((l) => l(paneId, exitCode));
    });
    this.procs.set(paneId, proc);
    // POSIX shells need the cwd-reporting hook injected into the live session
    // (Windows gets it via the -Command bootstrap above). The leading newline
    // keeps it off the user's first prompt line.
    if (process.platform !== 'win32') {
      proc.write(`${posixCwdHook(shell)}\r`);
    }
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
