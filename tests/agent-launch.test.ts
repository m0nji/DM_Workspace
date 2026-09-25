import { existsSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkAgentRequirements, parseCheckOutput, launchPreparedAgent } from '../src/main/agent-launch';
import { builtinAgentProfile } from '../src/shared/agent-profiles';

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
    expect(await checkAgentRequirements(shell, builtinAgentProfile('claude'), env)).toBe('missing-cli');
    expect(await checkAgentRequirements(shell, builtinAgentProfile('codex'), env)).toBe('missing-cli');
    expect(await checkAgentRequirements('/missing/sh', builtinAgentProfile('claude'), env)).toBe('check-failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('never writes a prepared command after its terminal has been replaced', async () => {
  const original = { shell: '/bin/sh', nonce: 'a'.repeat(64) };
  let current: typeof original | undefined = original;
  const writes: string[] = [];
  const result = launchPreparedAgent('p', builtinAgentProfile('claude'), {
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
  const first = launchPreparedAgent('p', builtinAgentProfile('claude'), backend, bridge);
  await expect(launchPreparedAgent('p', builtinAgentProfile('claude'), backend, bridge)).rejects.toThrow('already');
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
    expect(await checkAgentRequirements(shell, builtinAgentProfile('codex'), env)).toBe('missing-node');
    writeFileSync(join(dir, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    expect(await checkAgentRequirements(shell, builtinAgentProfile('codex'), env)).toBe('ready');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('checks tools in the project directory used by shell startup', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-project-check-'));
  const shell = join(dir, 'sh');
  try {
    writeFileSync(shell, '#!/bin/sh\nexport PATH="$PWD"\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 });
    writeFileSync(join(dir, 'claude'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    expect(await checkAgentRequirements(shell, builtinAgentProfile('claude'), {}, dir)).toBe('ready');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('checks a custom program with spaces and never executes shell syntax in its name', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-custom-'));
  try {
    const shell = isolatedShell(dir);
    const bin = join(dir, 'my tools');
    mkdirSync(bin);
    writeFileSync(join(bin, 'fake agent'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const profile = { ...builtinAgentProfile('opencode'), id: 'custom-1', adapter: 'generic' as const };
    expect(await checkAgentRequirements(shell, { ...profile, command: 'fake agent' }, { PATH: `${bin}:/usr/bin:/bin` })).toBe('ready');
    expect(await checkAgentRequirements(shell, { ...profile, command: join(bin, 'fake agent') }, { PATH: '/usr/bin:/bin' })).toBe('ready');
    const marker = join(dir, 'pwned');
    expect(await checkAgentRequirements(shell, { ...profile, command: `x; touch '${marker}'` }, { PATH: '/usr/bin:/bin' })).toBe('missing-cli');
    expect(existsSync(marker)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('quotes typographic single quotes of the program name in the PowerShell check script', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-ps-check-'));
  try {
    // A stand-in "pwsh" that records the -Command script instead of running it.
    const shell = join(dir, 'pwsh');
    writeFileSync(shell, `#!/bin/sh\nprintf '%s' "$4" > '${join(dir, 'script.txt')}'\necho DMWS_PS_7.4; echo DMWS_EXT_exe; echo DMWS_CHECK_ready\n`, { mode: 0o700 });
    const profile = { ...builtinAgentProfile('opencode'), id: 'custom-1', adapter: 'generic' as const, command: 'agent\u2019; Remove-Item x; \u2018' };
    expect(await checkAgentRequirements(shell, profile, { PATH: '/usr/bin:/bin' }, dir)).toBe('ready');
    expect(readFileSync(join(dir, 'script.txt'), 'utf8')).toMatch(/^\$dmwsApp = Get-Command 'agent\u2019\u2019; Remove-Item x; \u2018\u2018' -CommandType Application /);
    // Profile variables are set first, quoted the same way.
    expect(await checkAgentRequirements(shell, { ...profile, env: { PATH: 'C:\\it\u2019s', NOTE: "a'b" } }, { PATH: '/usr/bin:/bin' }, dir)).toBe('ready');
    expect(readFileSync(join(dir, 'script.txt'), 'utf8')).toMatch(/^\$env:PATH = 'C:\\it\u2019\u2019s'; \$env:NOTE = 'a''b'; \$dmwsApp = Get-Command /);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it.skipIf(process.platform === 'win32')('checks with the profile environment, so a profile that sets PATH finds its program', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-env-check-'));
  try {
    const shell = isolatedShell(dir);
    const bin = join(dir, 'profile bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'env-agent'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const profile = { ...builtinAgentProfile('opencode'), id: 'custom-1', adapter: 'generic' as const, command: 'env-agent' };
    const env = { PATH: '/usr/bin:/bin' };
    expect(await checkAgentRequirements(shell, profile, env, dir)).toBe('missing-cli');
    expect(await checkAgentRequirements(shell, { ...profile, env: { PATH: `${bin}:/usr/bin:/bin` } }, env, dir)).toBe('ready');
    expect(env).toEqual({ PATH: '/usr/bin:/bin' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('turns PowerShell host facts into an argument decision', () => {
  const profile = { ...builtinAgentProfile('opencode'), args: ['a"b'] };
  expect(parseCheckOutput('DMWS_PS_5.1\r\nDMWS_EXT_exe\r\nDMWS_CHECK_ready\r\n', profile, true)).toBe('unsupported-argument');
  expect(parseCheckOutput('DMWS_PS_7.4\nDMWS_EXT_exe\nDMWS_CHECK_ready\n', profile, true)).toBe('ready');
  expect(parseCheckOutput('DMWS_CHECK_ready\n', profile, true)).toBe('check-failed');
  expect(parseCheckOutput('DMWS_CHECK_missing-cli\n', profile, true)).toBe('missing-cli');
  expect(parseCheckOutput('noise\nDMWS_CHECK_ready\n', profile, false)).toBe('ready');
});
