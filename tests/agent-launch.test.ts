import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkAgentRequirements, launchPreparedAgent } from '../src/main/agent-launch';

function isolatedShell(dir: string): string {
  const path = join(dir, 'sh');
  writeFileSync(path, '#!/bin/sh\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 });
  return path;
}

it.skipIf(process.platform === 'win32')('checks CLI and Node availability in a real shell without starting a model', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-check-'));
  try {
    const shell = isolatedShell(dir);
    const env = { PATH: '/nonexistent' };
    expect(await checkAgentRequirements(shell, 'claude', env)).toBe('missing-cli');
    expect(await checkAgentRequirements(shell, 'codex', env)).toBe('missing-cli');
    expect(await checkAgentRequirements('/missing/sh', 'claude', env)).toBe('check-failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('never writes a prepared command after its terminal has been replaced', async () => {
  const original = { shell: '/bin/sh', nonce: 'a'.repeat(64) };
  let current: typeof original | undefined = original;
  const writes: string[] = [];
  const result = launchPreparedAgent('p', 'claude', {
    sessionInfo: () => current,
    write: (_id, text) => writes.push(text)
  }, { prepare: () => { current = undefined; return Promise.resolve({ command: 'claude --settings test', launchCommand: 'short-start', settingsPath: 'test' }); } });
  await expect(result).rejects.toThrow('Terminal session changed');
  expect(writes).toEqual([]);
});

it('rejects a duplicate launch while the first setup is pending', async () => {
  const session = { shell: '/bin/sh', nonce: 'a'.repeat(64) };
  const writes: string[] = [];
  let ready!: () => void;
  const gate = new Promise<void>(resolve => { ready = resolve; });
  const backend = { sessionInfo: () => session, write: (_id: string, text: string) => writes.push(text) };
  const bridge = { prepare: async () => { await gate; return { command: 'claude --settings test', launchCommand: 'short-start', settingsPath: 'test' }; } };
  const first = launchPreparedAgent('p', 'claude', backend, bridge);
  await expect(launchPreparedAgent('p', 'claude', backend, bridge)).rejects.toThrow('already');
  ready();
  await first;
  expect(writes).toEqual(['short-start\r']);
});

it.skipIf(process.platform === 'win32')('distinguishes a missing Node runtime from an installed Codex CLI', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-check-'));
  try {
    writeFileSync(join(dir, 'codex'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const shell = isolatedShell(dir);
    const env = { PATH: dir };
    expect(await checkAgentRequirements(shell, 'codex', env)).toBe('missing-node');
    writeFileSync(join(dir, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    expect(await checkAgentRequirements(shell, 'codex', env)).toBe('ready');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('checks tools in the project directory used by shell startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-project-check-'));
  const shell = join(dir, 'sh');
  try {
    writeFileSync(shell, '#!/bin/sh\nexport PATH="$PWD"\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 });
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    expect(await checkAgentRequirements(shell, 'claude', {}, dir)).toBe('ready');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
