import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

import type { CodexRemoteAction, CodexRemoteResult } from '../shared/types';

// Only fixed CLI operations cross the shell boundary. In particular, no UI text
// or pairing credentials are interpolated into a command or logged.
export type CodexRemoteOperation = 'status' | 'start' | 'pair' | 'disable' | 'stop';

export function codexRemoteScript(operation: CodexRemoteOperation, powershell: boolean): string {
  const args = operation === 'status' ? 'app-server daemon version'
    : operation === 'disable' ? 'app-server daemon disable-remote-control'
    : `remote-control ${operation} --json`;
  return powershell
    ? `& (Get-Command codex -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source ${args}; exit $LASTEXITCODE`
    : `command codex ${args}`;
}

export function parseCodexJson(stdout: string): Record<string, unknown> {
  // Shell profiles can print banners. Accept a complete JSON object, never
  // interpret arbitrary partial JSON or include the output in an error.
  try {
    const value: unknown = JSON.parse(stdout);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* try lines */ }
  for (const line of stdout.split(/\r?\n/).reverse()) {
    try {
      const value: unknown = JSON.parse(line);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
    } catch { /* profile output */ }
  }
  throw new Error('Invalid Codex response');
}

export function runCodexRemote(shell: string, operation: CodexRemoteOperation): Promise<Record<string, unknown>> {
  const powershell = /(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(shell);
  if (!powershell && !/(?:^|[/\\])(?:bash|zsh|sh)(?:\.exe)?$/i.test(shell)) return Promise.reject(new Error('Unsupported shell'));
  const script = codexRemoteScript(operation, powershell);
  const args = powershell ? ['-NoLogo', '-NonInteractive', '-Command', script] : ['-ilc', script];
  return new Promise((resolve, reject) => {
    execFile(shell, args, { timeout: 45_000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { reject(new Error('Codex operation failed')); return; }
      // This daemon command acknowledges success by exit code, not JSON.
      if (operation === 'disable') { resolve({}); return; }
      try { resolve(parseCodexJson(stdout)); } catch { reject(new Error('Invalid Codex response')); }
    });
  });
}

// The version response supplies the actual socket path, including a CODEX_HOME
// configured by a login shell. Only this one non-secret preference is returned.
export async function readCodexRemoteEnabled(version: Record<string, unknown> = {}): Promise<boolean | null> {
  const root = typeof version.socketPath === 'string' && isAbsolute(version.socketPath)
    ? dirname(dirname(version.socketPath)) : process.env.CODEX_HOME || join(homedir(), '.codex');
  try {
    const value: unknown = JSON.parse(await readFile(join(root, 'app-server-daemon', 'settings.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const enabled = (value as Record<string, unknown>).remoteControlEnabled;
    return typeof enabled === 'boolean' ? enabled : null;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : null;
  }
}

export async function codexRemoteAction(
  shell: string, action: CodexRemoteAction,
  run: typeof runCodexRemote = runCodexRemote,
  readEnabled: typeof readCodexRemoteEnabled = readCodexRemoteEnabled
): Promise<CodexRemoteResult> {
  try {
    if (action === 'status' || action === 'disable' || action === 'stop') {
      if (action !== 'status') await run(shell, action);
      const result = await run(shell, 'status');
      const status = result.status === 'running' ? 'running'
        : result.status === 'stopped' || result.status === 'notRunning' ? 'stopped' : null;
      if (!status) return { status: 'error', reason: 'invalid-response' };
      const remoteEnabled = await readEnabled(result);
      if (action === 'disable' && remoteEnabled !== false) return { status: 'error', reason: 'invalid-response' };
      return { status, remoteEnabled,
        ...(typeof result.cliVersion === 'string' && /^[\w.+-]{1,64}$/.test(result.cliVersion) ? { cliVersion: result.cliVersion } : {}) };
    }
    if (action === 'enable') {
      const start = await run(shell, 'start');
      if (start.status !== 'connected' || start.timedOut === true) return { status: 'error', reason: 'connection' };
      return { status: 'running', remoteEnabled: true, connected: true };
    }
    // Pairing must not override the global off switch, including an external CLI change.
    const current = await run(shell, 'status');
    if (current.status !== 'running' || await readEnabled(current) !== true) return { status: 'error', reason: 'connection' };
    const result = await run(shell, 'pair');
    const expiry = typeof result.expiresAt === 'number'
      ? result.expiresAt * (result.expiresAt < 1e12 ? 1000 : 1)
      : typeof result.expiresAt === 'string' ? Date.parse(result.expiresAt) : NaN;
    if (typeof result.manualPairingCode !== 'string' || !/^[a-zA-Z0-9 -]{4,128}$/.test(result.manualPairingCode)
      || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 24 * 60 * 60 * 1000) return { status: 'error', reason: 'invalid-response' };
    return { status: 'paired-code', code: result.manualPairingCode, expiresAt: new Date(expiry).toISOString() };
  } catch { return { status: 'error', reason: 'unavailable' }; }
}
