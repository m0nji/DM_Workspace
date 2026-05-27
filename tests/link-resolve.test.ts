// ipc.ts imports electron at the top level. Stub it out so vitest (node env)
// can import the module without Electron being present.
import { vi } from 'vitest';
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  BrowserWindow: vi.fn(),
  dialog: {},
  app: { getPath: vi.fn(() => '/tmp') },
  Notification: { isSupported: vi.fn(() => false) },
  clipboard: { readText: vi.fn(), writeText: vi.fn() },
}));

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveLinkPath } from '../src/main/ipc';

let root: string;

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'linkres-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('resolveLinkPath', () => {
  it('finds the file directly under cwd', () => {
    writeFileSync(join(root, 'a.md'), '# hi');
    expect(resolveLinkPath('a.md', root, [])).toBe(join(root, 'a.md'));
  });

  it('finds the file in a direct subdir of cwd when missing under cwd', () => {
    mkdirSync(join(root, 'sub', 'docs'), { recursive: true });
    writeFileSync(join(root, 'sub', 'docs', 'r.md'), '# hi');
    expect(resolveLinkPath('docs/r.md', root, [])).toBe(join(root, 'sub', 'docs', 'r.md'));
  });

  it('falls back to a workspace root', () => {
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    writeFileSync(join(ws, 'x.md'), '# hi');
    try {
      expect(resolveLinkPath('x.md', root, [ws])).toBe(join(ws, 'x.md'));
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('skips node_modules and dot directories when scanning subdirs', () => {
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'pkg', 'r.md'), '# hi');
    expect(resolveLinkPath('pkg/r.md', root, [])).toBeNull();
  });

  it('skips dot directories when scanning subdirs', () => {
    mkdirSync(join(root, '.hidden', 'docs'), { recursive: true });
    writeFileSync(join(root, '.hidden', 'docs', 'r.md'), '# hi');
    expect(resolveLinkPath('docs/r.md', root, [])).toBeNull();
  });

  it('prefers the file directly under cwd over a copy in a subdir', () => {
    writeFileSync(join(root, 'r.md'), 'top');
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'sub', 'r.md'), 'nested');
    expect(resolveLinkPath('r.md', root, [])).toBe(join(root, 'r.md'));
  });

  it('never ascends out of cwd (a ../ rel cannot reach files above cwd)', () => {
    writeFileSync(join(root, 'secret.md'), 'x');
    const cwd = join(root, 'inner');
    mkdirSync(cwd, { recursive: true });
    // secret.md liegt OBERHALB von cwd → der reine Abwärts-Walk darf es nie finden
    expect(resolveLinkPath('../secret.md', cwd, [])).toBeNull();
    expect(resolveLinkPath('secret.md', cwd, [])).toBeNull();
  });

  it('finds a bare filename several levels deep', () => {
    mkdirSync(join(root, 'DM_Workspace', 'docs', 'superpowers', 'specs'), { recursive: true });
    const target = join(root, 'DM_Workspace', 'docs', 'superpowers', 'specs', 'deep.md');
    writeFileSync(target, '# hi');
    expect(resolveLinkPath('deep.md', root, [])).toBe(target);
  });

  it('finds a partial path deep in the tree', () => {
    mkdirSync(join(root, 'a', 'b', 'specs'), { recursive: true });
    const target = join(root, 'a', 'b', 'specs', 'p.md');
    writeFileSync(target, '# hi');
    expect(resolveLinkPath('specs/p.md', root, [])).toBe(target);
  });

  it('prefers the shallowest match when the name exists at two depths', () => {
    mkdirSync(join(root, 'shallow', 'deeper'), { recursive: true });
    const near = join(root, 'shallow', 'dup.md');
    writeFileSync(near, 'near');
    writeFileSync(join(root, 'shallow', 'deeper', 'dup.md'), 'far');
    expect(resolveLinkPath('dup.md', root, [])).toBe(near);
  });

  it('returns null for a file beyond maxDepth', () => {
    mkdirSync(join(root, 'a', 'b', 'c'), { recursive: true });
    writeFileSync(join(root, 'a', 'b', 'c', 'x.md'), '# hi');
    expect(resolveLinkPath('x.md', root, [], { maxDepth: 1 })).toBeNull();
  });

  it('stops after maxDirs without finding and returns null', () => {
    for (const d of ['d1', 'd2', 'd3']) mkdirSync(join(root, d), { recursive: true });
    writeFileSync(join(root, 'd3', 'late.md'), '# hi');
    // maxDirs=1 → only the start base is visited, subdirs are not
    expect(resolveLinkPath('late.md', root, [], { maxDirs: 1 })).toBeNull();
  });

  it('does not traverse into a symlinked directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'sl.md'), '# hi');
    try {
      symlinkSync(outside, join(root, 'link'), 'dir');
      expect(resolveLinkPath('sl.md', root, [])).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('returns null when nothing matches', () => {
    expect(resolveLinkPath('nope.md', root, [])).toBeNull();
  });

  it('returns null when cwd is unreadable and no root matches', () => {
    expect(resolveLinkPath('a.md', join(root, 'does-not-exist'), [])).toBeNull();
  });
});
