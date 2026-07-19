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
    writeFileSync(join(root, 'secret.md'), 'x'); // lives ABOVE cwd
    const cwd = join(root, 'inner');
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'present.md'), 'y'); // proves the BFS actually ran
    expect(resolveLinkPath('present.md', cwd, [])).toBe(join(cwd, 'present.md'));
    // secret.md is above cwd; the downward-only walk must never reach it
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

  it('still searches a nested root when the cwd BFS exhausts its own budget', () => {
    // cwd has sibling dirs that consume its tiny budget before reaching the nested root
    for (const d of ['s1', 's2', 's3']) mkdirSync(join(root, d), { recursive: true });
    const nested = join(root, 'workspace');
    mkdirSync(nested, { recursive: true });
    const target = join(nested, 'inside.md');
    writeFileSync(target, '# hi');
    // nested root is inside cwd; with maxDirs:1 the cwd BFS is capped before finding it,
    // so the nested root must still be walked under its own budget
    expect(resolveLinkPath('inside.md', root, [nested], { maxDirs: 1 })).toBe(target);
  });

  it('deduplicates equivalent cwd and workspace roots before walking', () => {
    const visited: string[] = [];

    expect(resolveLinkPath('missing.md', root, [root, `${root}/`], {
      maxDepth: 0,
      onVisitDir: (dir) => visited.push(dir),
    })).toBeNull();

    expect(visited).toEqual([root]);
  });

  it('still searches a root after a cwd subtree exhausts its own maxDirs budget', () => {
    for (const d of ['x1', 'x2', 'x3']) mkdirSync(join(root, d), { recursive: true });
    const ws = mkdtempSync(join(tmpdir(), 'ws-'));
    writeFileSync(join(ws, 'r.md'), '# hi');
    try {
      // maxDirs:1 exhausts cwd's budget immediately, but the root gets its own budget
      expect(resolveLinkPath('r.md', root, [ws], { maxDirs: 1 })).toBe(join(ws, 'r.md'));
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it('does not traverse into a symlinked directory', () => {
    const outside = mkdtempSync(join(tmpdir(), 'outside-'));
    writeFileSync(join(outside, 'sl.md'), '# hi');
    try {
      symlinkSync(outside, join(root, 'link'), 'dir');
      expect(resolveLinkPath('sl.md', root, [])).toBeNull();
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(join(root, 'link'), { force: true });
    }
  });

  // --- git worktrees -------------------------------------------------------
  // Linked worktrees live outside the repo (or under dot-dirs the BFS skips),
  // so resolution must derive them from git's own metadata. The fixtures
  // fabricate that metadata by hand — no real git needed.

  /** Wire up a main checkout and one linked worktree via .git metadata. */
  function makeWorktreePair(repo: string, wt: string, name = 'wt1'): void {
    mkdirSync(join(repo, '.git', 'worktrees', name), { recursive: true });
    mkdirSync(wt, { recursive: true });
    writeFileSync(join(repo, '.git', 'worktrees', name, 'gitdir'), join(wt, '.git') + '\n');
    writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', name)}\n`);
  }

  it('finds a file in a linked worktree outside the repo', () => {
    const repo = join(root, 'repo');
    const wt = join(root, 'repo-worktrees', 'feature');
    makeWorktreePair(repo, wt);
    mkdirSync(join(wt, 'docs'), { recursive: true });
    const target = join(wt, 'docs', 'concept.md');
    writeFileSync(target, '# hi');
    expect(resolveLinkPath('docs/concept.md', repo, [])).toBe(target);
  });

  it('finds a file in a worktree under a dot-dir inside the repo', () => {
    const repo = join(root, 'repo');
    const wt = join(root, 'repo', '.worktrees', 'feature');
    makeWorktreePair(repo, wt);
    const target = join(wt, 'hidden.md');
    writeFileSync(target, '# hi');
    expect(resolveLinkPath('hidden.md', repo, [])).toBe(target);
  });

  it('finds a file in the main checkout when cwd is a linked worktree', () => {
    const repo = join(root, 'repo');
    const wt = join(root, 'repo-worktrees', 'feature');
    makeWorktreePair(repo, wt);
    const target = join(repo, 'main-only.md');
    writeFileSync(target, '# hi');
    expect(resolveLinkPath('main-only.md', wt, [])).toBe(target);
  });

  it('finds a worktree file when cwd is a subdir of the repo', () => {
    const repo = join(root, 'repo');
    const wt = join(root, 'repo-worktrees', 'feature');
    makeWorktreePair(repo, wt);
    const sub = join(repo, 'src');
    mkdirSync(sub, { recursive: true });
    const target = join(wt, 'notes.md');
    writeFileSync(target, '# hi');
    expect(resolveLinkPath('notes.md', sub, [])).toBe(target);
  });

  it('prefers a match under cwd over the same rel in a worktree', () => {
    const repo = join(root, 'repo');
    const wt = join(root, 'repo-worktrees', 'feature');
    makeWorktreePair(repo, wt);
    const near = join(repo, 'dup.md');
    writeFileSync(near, 'near');
    writeFileSync(join(wt, 'dup.md'), 'far');
    expect(resolveLinkPath('dup.md', repo, [])).toBe(near);
  });

  it('ignores stale worktree metadata pointing at a deleted dir', () => {
    const repo = join(root, 'repo');
    mkdirSync(join(repo, '.git', 'worktrees', 'gone'), { recursive: true });
    writeFileSync(join(repo, '.git', 'worktrees', 'gone', 'gitdir'), join(root, 'nope', '.git') + '\n');
    expect(resolveLinkPath('missing.md', repo, [])).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(resolveLinkPath('nope.md', root, [])).toBeNull();
  });

  it('returns null when cwd is unreadable and no root matches', () => {
    expect(resolveLinkPath('a.md', join(root, 'does-not-exist'), [])).toBeNull();
  });
});
