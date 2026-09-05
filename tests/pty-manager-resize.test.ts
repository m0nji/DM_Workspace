import { describe, it, expect, beforeEach, vi } from 'vitest';

// The sibling pty-manager.test.ts drives a real shell and therefore skips
// outside an Electron runtime (node-pty is built against Electron's ABI). The
// resize bookkeeping below is pure logic, so it is worth having under plain
// Node — mock the native addon and the two modules that would otherwise pull in
// Electron or write shell-integration files to disk.

interface FakePty {
  cols: number;
  rows: number;
  resizes: Array<{ cols: number; rows: number }>;
  exitListeners: Array<(e: { exitCode: number }) => void>;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number }) => void): void;
  resize(cols: number, rows: number): void;
  write(data: string): void;
  kill(): void;
}

const mocks = vi.hoisted(() => ({ spawned: [] as FakePty[] }));

// These tests exercise shell selection / resize bookkeeping with a fake PTY.
// The selected shell need not be installed on the host running the tests.
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return { ...actual, accessSync: vi.fn(), statSync: vi.fn(() => ({ isFile: () => true })) };
});

vi.mock('node-pty', () => ({
  spawn: (_file: string, _args: string[], opts: { cols: number; rows: number }): FakePty => {
    const proc: FakePty = {
      cols: opts.cols,
      rows: opts.rows,
      resizes: [],
      exitListeners: [],
      onData: () => {},
      onExit: (cb) => { proc.exitListeners.push(cb); },
      resize: (cols, rows) => { proc.resizes.push({ cols, rows }); },
      write: () => {},
      // Fire the exit listeners synchronously so killAllAndWait resolves
      // without leaning on its safety timeout.
      kill: () => { for (const cb of [...proc.exitListeners]) cb({ exitCode: 0 }); }
    };
    mocks.spawned.push(proc);
    return proc;
  }
}));

vi.mock('electron', () => ({ app: { getPath: () => process.cwd() } }));

vi.mock('../src/main/shell-integration', () => ({
  shellArgs: () => [],
  bashPromptCommand: () => '',
  writeZshIntegrationDir: () => 'zsh-integration',
  writeScreenIntegration: () => 'screenrc'
}));

const { PtyManager } = await import('../src/main/pty-manager');

const spawnOpts = (cols: number, rows: number) => ({ cwd: process.cwd(), cols, rows });
const last = (): FakePty => mocks.spawned[mocks.spawned.length - 1];

beforeEach(() => { mocks.spawned.length = 0; });

// A resize for a pane that has no process used to be a silent no-op: the size
// was dropped on the floor and nothing ever asked for it again. It is now
// remembered and applied when the pane spawns.
describe('PtyManager pending resize', () => {
  it('applies a size that arrived before the pane had a process', () => {
    const mgr = new PtyManager();
    mgr.resize('p1', 100, 30);
    mgr.spawn('p1', spawnOpts(80, 24));
    expect(last().resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('does not resize when the remembered size matches the spawn size', () => {
    const mgr = new PtyManager();
    mgr.resize('p1', 80, 24);
    mgr.spawn('p1', spawnOpts(80, 24));
    expect(last().resizes).toEqual([]); // the pty already started at that size
  });

  it('remembers only the most recent size', () => {
    const mgr = new PtyManager();
    mgr.resize('p1', 100, 30);
    mgr.resize('p1', 120, 40);
    mgr.spawn('p1', spawnOpts(80, 24));
    expect(last().resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it('keeps panes apart', () => {
    const mgr = new PtyManager();
    mgr.resize('p1', 100, 30);
    mgr.spawn('p2', spawnOpts(80, 24));
    expect(last().resizes).toEqual([]); // p1's size must not reach p2
  });

  it('does not throw for a pane that never spawns', () => {
    const mgr = new PtyManager();
    expect(() => mgr.resize('ghost', 100, 30)).not.toThrow();
  });
});

// The renderer forwards the pane's current geometry on every settled layout
// change, so the same size arrives again and again. Passing an unchanged size
// to the pty costs a SIGWINCH, and a SIGWINCH makes TUIs repaint for nothing.
describe('PtyManager resize dedupe', () => {
  it('drops a resize that repeats the spawn size', () => {
    const mgr = new PtyManager();
    mgr.spawn('p1', spawnOpts(80, 24));
    mgr.resize('p1', 80, 24);
    expect(last().resizes).toEqual([]);
  });

  it('drops a resize that repeats the previous size', () => {
    const mgr = new PtyManager();
    mgr.spawn('p1', spawnOpts(80, 24));
    mgr.resize('p1', 100, 30);
    mgr.resize('p1', 100, 30);
    mgr.resize('p1', 100, 30);
    expect(last().resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('forwards every real change, including height-only ones', () => {
    const mgr = new PtyManager();
    mgr.spawn('p1', spawnOpts(80, 24));
    mgr.resize('p1', 100, 30);
    mgr.resize('p1', 100, 31); // same width, taller pane
    mgr.resize('p1', 90, 31); // same height, narrower pane
    expect(last().resizes).toEqual([
      { cols: 100, rows: 30 },
      { cols: 100, rows: 31 },
      { cols: 90, rows: 31 }
    ]);
  });
});

// A remembered size outliving its pane would be worse than the bug it fixes:
// the next pane on that id would be resized to a size nobody asked for.
describe('PtyManager forgets sizes with the pane', () => {
  it('kill drops a size remembered for a pane that never spawned', () => {
    const mgr = new PtyManager();
    mgr.resize('p1', 100, 30);
    mgr.kill('p1');
    mgr.spawn('p1', spawnOpts(80, 24));
    expect(last().resizes).toEqual([]);
  });

  it('exit clears the size, so the respawned pane starts from its spawn size', () => {
    const mgr = new PtyManager();
    mgr.spawn('p1', spawnOpts(80, 24));
    mgr.resize('p1', 100, 30);
    for (const cb of [...last().exitListeners]) cb({ exitCode: 0 });

    mgr.spawn('p1', spawnOpts(80, 24));
    expect(last().resizes).toEqual([]); // nothing stale applied at spawn
    mgr.resize('p1', 100, 30);
    // Deduped against the *new* pane's spawn size, not the dead pane's last one.
    expect(last().resizes).toEqual([{ cols: 100, rows: 30 }]);
  });

  it('killAllAndWait clears the sizes', async () => {
    const mgr = new PtyManager();
    mgr.spawn('p1', spawnOpts(80, 24));
    mgr.resize('p1', 100, 30);
    await mgr.killAllAndWait(50);

    mgr.spawn('p1', spawnOpts(80, 24));
    expect(last().resizes).toEqual([]); // no 100x30 carried over to the new pty
  });
});
