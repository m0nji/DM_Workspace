import { execFile } from 'node:child_process';

import type { CodexRemoteAction, CodexRemoteResult } from '../shared/types';

// Only fixed CLI operations cross the shell boundary. In particular, no UI text
// or pairing credentials are interpolated into a command or logged.
export function codexRemoteScript(operation: 'status' | 'start' | 'pair', powershell: boolean): string {
  const args = operation === 'status' ? 'app-server daemon version'
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

export function runCodexRemote(shell: string, operation: 'status' | 'start' | 'pair'): Promise<Record<string, unknown>> {
  const powershell = /(?:^|[/\\])(?:powershell|pwsh)(?:\.exe)?$/i.test(shell);
  if (!powershell && !/(?:^|[/\\])(?:bash|zsh|sh)(?:\.exe)?$/i.test(shell)) return Promise.reject(new Error('Unsupported shell'));
  const script = codexRemoteScript(operation, powershell);
  const args = powershell ? ['-NoLogo', '-NonInteractive', '-Command', script] : ['-ilc', script];
  return new Promise((resolve, reject) => {
    execFile(shell, args, { timeout: 45_000, maxBuffer: 256 * 1024, windowsHide: true }, (error, stdout) => {
      if (error) { reject(new Error('Codex operation failed')); return; }
      try { resolve(parseCodexJson(stdout)); } catch { reject(new Error('Invalid Codex response')); }
    });
  });
}

export async function codexRemoteAction(
  shell: string, action: CodexRemoteAction,
  run: typeof runCodexRemote = runCodexRemote
): Promise<CodexRemoteResult> {
  try {
    if (action === 'status') {
      const result = await run(shell, 'status');
      if (result.status === 'running') return { status: 'running' };
      if (result.status === 'stopped' || result.status === 'notRunning') return { status: 'stopped' };
      return { status: 'error', reason: 'invalid-response' };
    }
    const start = await run(shell, 'start');
    if (start.status !== 'connected' || start.timedOut === true) return { status: 'error', reason: 'connection' };
    const result = await run(shell, 'pair');
    const expiry = typeof result.expiresAt === 'number'
      ? result.expiresAt * (result.expiresAt < 1e12 ? 1000 : 1)
      : typeof result.expiresAt === 'string' ? Date.parse(result.expiresAt) : NaN;
    if (typeof result.manualPairingCode !== 'string' || !/^[a-zA-Z0-9 -]{4,128}$/.test(result.manualPairingCode)
      || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 24 * 60 * 60 * 1000) return { status: 'error', reason: 'invalid-response' };
    return { status: 'paired-code', code: result.manualPairingCode, expiresAt: new Date(expiry).toISOString() };
  } catch { return { status: 'error', reason: 'unavailable' }; }
}
