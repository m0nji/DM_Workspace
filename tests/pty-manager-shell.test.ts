import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Same mocking rationale as pty-manager-resize.test.ts: the shell choice is
// pure logic, so it runs under plain Node with the native addon and the two
// Electron-bound modules replaced.

const mocks = vi.hoisted(() => ({ spawned: [] as string[] }));

// These tests exercise shell selection / resize bookkeeping with a fake PTY.
// The selected shell need not be installed on the host running the tests.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, accessSync: vi.fn(), statSync: vi.fn(() => ({ isFile: () => true })) };
});

vi.mock('node-pty', () => ({
  spawn: (file: string) => {
    mocks.spawned.push(file);
    return {
      onData: () => {},
      onExit: () => {},
      resize: () => {},
      write: () => {},
      kill: () => {}
    };
  }
}));

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }));

vi.mock('../src/main/shell-integration', () => ({
  shellArgs: () => [],
  bashPromptCommand: () => '',
  writeZshIntegrationDir: () => 'zsh-integration',
  writeScreenIntegration: () => 'screenrc'
}));

const { resolveWindowsShell } = await import('../src/main/pty-manager');

const opts = { cwd: process.cwd(), cols: 80, rows: 24 };

// The module caches the resolved shell for the lifetime of the process, so each
// case needs a fresh module instance.
async function freshManager() {
  vi.resetModules();
  const { PtyManager } = await import('../src/main/pty-manager');
  return new PtyManager();
}

describe('resolveWindowsShell', () => {
  const pwshDir = 'C:\\Program Files\\PowerShell\\7';
  const pwsh = join(pwshDir, 'pwsh.exe');

  it('returns the first pwsh.exe on PATH', () => {
    const exists = (file: string): boolean => file === pwsh;
    expect(resolveWindowsShell(`C:\\Windows;${pwshDir};C:\\Other`, exists)).toBe(pwsh);
  });

  it('stops looking once it has a hit', () => {
    const seen: string[] = [];
    const exists = (file: string): boolean => { seen.push(file); return file === pwsh; };
    resolveWindowsShell(`C:\\Windows;${pwshDir};C:\\Other`, exists);
    expect(seen).toEqual([join('C:\\Windows', 'pwsh.exe'), pwsh]); // C:\Other never probed
  });

  it('falls back to powershell.exe when pwsh is nowhere on PATH', () => {
    expect(resolveWindowsShell('C:\\Windows;C:\\Other', () => false)).toBe('powershell.exe');
  });

  it('falls back for an empty, blank or missing PATH', () => {
    expect(resolveWindowsShell('', () => true)).toBe('powershell.exe');
    expect(resolveWindowsShell(';;', () => true)).toBe('powershell.exe');
    expect(resolveWindowsShell(undefined, () => true)).toBe('powershell.exe');
  });

  it('copes with quoted and padded PATH entries', () => {
    const exists = (file: string): boolean => file === pwsh;
    expect(resolveWindowsShell(`"${pwshDir}"`, exists)).toBe(pwsh);
    expect(resolveWindowsShell(`   ${pwshDir}   `, exists)).toBe(pwsh);
  });

  it('falls back instead of throwing when the lookup fails', () => {
    const exists = (): boolean => { throw new Error('EPERM'); };
    expect(resolveWindowsShell(pwshDir, exists)).toBe('powershell.exe');
  });
});

describe('PtyManager default shell', () => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  const realPath = process.env.PATH;
  const realShell = process.env.SHELL;
  let dir = '';

  const setPlatform = (value: string): void => {
    Object.defineProperty(process, 'platform', { value, configurable: true });
  };
  const restoreEnv = (name: 'PATH' | 'SHELL', value: string | undefined): void => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  beforeEach(() => {
    mocks.spawned.length = 0;
    dir = mkdtempSync(join(tmpdir(), 'dmws-pwsh-'));
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', realPlatform);
    restoreEnv('PATH', realPath);
    restoreEnv('SHELL', realShell);
    rmSync(dir, { recursive: true, force: true });
  });

  it('prefers pwsh on win32 when it is installed', async () => {
    const pwsh = join(dir, 'pwsh.exe');
    writeFileSync(pwsh, '', 'utf8');
    setPlatform('win32');
    process.env.PATH = dir;
    (await freshManager()).spawn('p1', opts);
    expect(mocks.spawned).toEqual([pwsh]);
  });

  it('keeps powershell.exe on win32 when pwsh is not installed', async () => {
    setPlatform('win32');
    process.env.PATH = dir; // exists, but holds no pwsh.exe
    (await freshManager()).spawn('p1', opts);
    expect(mocks.spawned).toEqual(['powershell.exe']);
  });

  it('resolves once per process, not once per pane', async () => {
    const pwsh = join(dir, 'pwsh.exe');
    writeFileSync(pwsh, '', 'utf8');
    setPlatform('win32');
    process.env.PATH = dir;
    const mgr = await freshManager();
    mgr.spawn('p1', opts);
    // Remove the executable: a second lookup could not find it any more, so a
    // second pwsh here can only come from the cache.
    unlinkSync(pwsh);
    mgr.spawn('p2', opts);
    expect(mocks.spawned).toEqual([pwsh, pwsh]);
  });

  it('lets an explicit shell win over the default', async () => {
    setPlatform('win32');
    process.env.PATH = dir;
    (await freshManager()).spawn('p1', { ...opts, shell: 'cmd.exe' });
    expect(mocks.spawned).toEqual(['cmd.exe']);
  });

  it('is unchanged on POSIX: $SHELL wins', async () => {
    setPlatform('darwin');
    process.env.SHELL = '/bin/bash';
    process.env.PATH = dir;
    (await freshManager()).spawn('p1', opts);
    expect(mocks.spawned).toEqual(['/bin/bash']);
  });

  it('is unchanged on POSIX: /bin/zsh without $SHELL', async () => {
    setPlatform('darwin');
    delete process.env.SHELL;
    (await freshManager()).spawn('p1', opts);
    expect(mocks.spawned).toEqual(['/bin/zsh']);
  });
});
