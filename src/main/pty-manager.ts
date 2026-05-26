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

// Launch as a login shell on macOS/Linux so /etc/zprofile (path_helper) and the
// user's ~/.zprofile/.zlogin run — exactly like Terminal.app. Without this a
// GUI-launched app inherits only a minimal PATH and tools installed under e.g.
// /opt/homebrew/bin (Homebrew) aren't found, even though they work in Terminal.
function shellArgs(): string[] {
  return process.platform === 'win32' ? [] : ['-l'];
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
    const proc = pty.spawn(opts.shell || defaultShell(), shellArgs(), {
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
