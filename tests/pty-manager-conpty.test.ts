import { describe, it, expect, afterEach, vi } from 'vitest';

// The inbox Windows ConPTY host dies when OpenCode exits and takes the shell
// with it. The ConPTY that node-pty bundles survives, so Windows panes use it.

const mocks = vi.hoisted(() => ({ options: [] as Record<string, unknown>[] }));

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, accessSync: vi.fn(), statSync: vi.fn(() => ({ isFile: () => true })) };
});

vi.mock('node-pty', () => ({
  spawn: (_file: string, _args: string[], options: Record<string, unknown>) => {
    mocks.options.push(options);
    return { onData: () => {}, onExit: () => {}, resize: () => {}, write: () => {}, kill: () => {} };
  }
}));

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }));

vi.mock('../src/main/shell-integration', () => ({
  shellArgs: () => [],
  bashPromptCommand: () => '',
  writeZshIntegrationDir: () => 'zsh-integration',
  writeScreenIntegration: () => 'screenrc'
}));

const realPlatform = process.platform;

async function spawnOn(platform: NodeJS.Platform): Promise<Record<string, unknown>> {
  Object.defineProperty(process, 'platform', { value: platform });
  vi.resetModules();
  mocks.options.length = 0;
  const { PtyManager } = await import('../src/main/pty-manager');
  new PtyManager().spawn('p1', { shell: platform === 'win32' ? 'powershell.exe' : '/bin/sh', cwd: process.cwd(), cols: 80, rows: 24 });
  return mocks.options[0];
}

describe('PtyManager ConPTY backend', () => {
  afterEach(() => { Object.defineProperty(process, 'platform', { value: realPlatform }); });

  it('uses the bundled ConPTY on Windows', async () => {
    expect((await spawnOn('win32')).useConptyDll).toBe(true);
  });

  it('passes no ConPTY option elsewhere', async () => {
    expect(await spawnOn('darwin')).not.toHaveProperty('useConptyDll');
  });
});
