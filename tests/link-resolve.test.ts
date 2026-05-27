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
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

  it('returns null when nothing matches', () => {
    expect(resolveLinkPath('nope.md', root, [])).toBeNull();
  });

  it('returns null when cwd is unreadable and no root matches', () => {
    expect(resolveLinkPath('a.md', join(root, 'does-not-exist'), [])).toBeNull();
  });
});
