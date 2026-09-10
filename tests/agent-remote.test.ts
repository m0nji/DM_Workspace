import { expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { codexRemoteAction, codexRemoteScript, parseCodexJson } from '../src/main/agent-remote';
import { codexSetup } from '../src/main/codex-status-setup';
import { migrateSettings } from '../src/main/persistence';

it('retains only explicit boolean remote preferences, leaving old installs disabled', () => {
  expect(migrateSettings({}).agentRemoteControl).toBeUndefined();
  expect(migrateSettings({ agentRemoteControl: { codex: true, claude: false, opencode: true } }).agentRemoteControl)
    .toEqual({ codex: true, claude: false });
  expect(migrateSettings({ agentRemoteControl: { codex: 'true', claude: 1 } }).agentRemoteControl).toEqual({});
});

it('parses JSON after shell banners and rejects null/arrays', () => {
  expect(parseCodexJson('banner\n{"status":"running"}\n')).toEqual({ status: 'running' });
  for (const text of ['null', '[]', 'not JSON']) expect(() => parseCodexJson(text)).toThrow();
});

it('checks status without enabling access or generating credentials', async () => {
  const run = vi.fn().mockResolvedValue({ status: 'running', socketPath: 'private' });
  expect(await codexRemoteAction('/bin/zsh', 'status', run)).toEqual({ status: 'running' });
  expect(run.mock.calls).toEqual([['/bin/zsh', 'status']]);
});

it('pairs only after a confirmed connection and returns only the manual code and expiry', async () => {
  const expires = Math.floor(Date.now() / 1000) + 600;
  const run = vi.fn().mockResolvedValueOnce({ status: 'connected', timedOut: false })
    .mockResolvedValueOnce({ manualPairingCode: 'ABCD-EFGH', pairingCode: 'private', environmentId: 'private', expiresAt: expires });
  expect(await codexRemoteAction('pwsh.exe', 'pair', run)).toEqual({ status: 'paired-code', code: 'ABCD-EFGH', expiresAt: new Date(expires * 1000).toISOString() });
  expect(run.mock.calls).toEqual([['pwsh.exe', 'start'], ['pwsh.exe', 'pair']]);
});

it('does not create codes when the relay is unavailable and never exposes CLI errors', async () => {
  const run = vi.fn().mockResolvedValue({ status: 'connecting', timedOut: true });
  expect(await codexRemoteAction('/bin/zsh', 'pair', run)).toEqual({ status: 'error', reason: 'connection' });
  expect(run).toHaveBeenCalledTimes(1);
  expect(await codexRemoteAction('/bin/zsh', 'pair', vi.fn().mockRejectedValue(new Error('secret token'))))
    .toEqual({ status: 'error', reason: 'unavailable' });
});

it('rejects expired and malformed pairing responses', async () => {
  for (const result of [{ manualPairingCode: 'ABCD', expiresAt: 1 }, { manualPairingCode: '<script>', expiresAt: Date.now() + 60000 }, {}]) {
    const run = vi.fn().mockResolvedValueOnce({ status: 'connected' }).mockResolvedValueOnce(result);
    expect(await codexRemoteAction('/bin/zsh', 'pair', run)).toEqual({ status: 'error', reason: 'invalid-response' });
  }
});

it('uses native Windows shims and bypasses POSIX user functions', () => {
  expect(codexRemoteScript('pair', true)).toContain('-CommandType Application');
  expect(codexRemoteScript('pair', true)).toContain('remote-control pair --json; exit $LASTEXITCODE');
  expect(codexRemoteScript('status', false)).toBe('command codex app-server daemon version');
});

it.skipIf(process.platform === 'win32')('launches a shared session in the correct directory and fails closed when the daemon cannot start', () => {
  const dir = mkdtempSync(join(tmpdir(), "dmws-remote-'quoted-"));
  const log = join(dir, 'argv.json');
  try {
    writeFileSync(join(dir, 'codex'), `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nif (args[0] === 'remote-control') process.exit(Number(process.env.FAIL_START || 0));\nfs.writeFileSync(process.env.ARGV_LOG, JSON.stringify(args));\n`, { mode: 0o700 });
    const setup = codexSetup(join(dir, 'hook.cjs'), 1234, 'token', false, true, 'a'.repeat(64));
    const env = { ...process.env, PATH: `${dir}:/usr/bin:/bin`, ARGV_LOG: log };
    // A user shell function must not add another --remote argument.
    execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', `codex() { exit 99; }; ${setup.command}`], { cwd: dir, env });
    const args = JSON.parse(readFileSync(log, 'utf8'));
    expect(args.slice(0, 5)).toEqual(['--remote', 'unix://', '--cd', realpathSync(dir), '-c']);
    expect(args[5]).toContain('type = "command"');
    rmSync(log);
    expect(() => execFileSync('/bin/bash', ['--noprofile', '--norc', '-c', setup.command], { cwd: dir, env: { ...env, FAIL_START: '7' } })).toThrow();
    expect(() => readFileSync(log)).toThrow();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
