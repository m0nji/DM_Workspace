import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { expandTilde, resolveCwd } from '../src/main/resolve-cwd';

// Tilde expansion and cwd resolution are deliberately separate: expandTilde is
// a pure string transform, while resolveCwd substitutes home for anything that
// doesn't exist. Asserting the expansion through resolveCwd cannot tell the two
// apart — a returned home could mean "expanded to home" or "expanded somewhere
// and fell back". So the expansion is asserted where it happens.
describe('expandTilde', () => {
  const home = homedir();

  it('returns home for "~", "~/" and empty input', () => {
    expect(expandTilde('~')).toBe(home);
    expect(expandTilde('~/')).toBe(home);
    expect(expandTilde('~\\')).toBe(home);
    expect(expandTilde('')).toBe(home);
    expect(expandTilde('   ')).toBe(home);
    expect(expandTilde(undefined)).toBe(home);
    expect(expandTilde(null)).toBe(home);
  });

  it('expands a leading tilde without touching the filesystem', () => {
    // Neither path exists on either platform — the point is that expansion is
    // a string operation and says nothing about what is on disk.
    expect(expandTilde('~/Library')).toBe(join(home, 'Library'));
    expect(expandTilde('~/no/such/dir')).toBe(join(home, 'no', 'such', 'dir'));
    expect(expandTilde('~\\Library')).toBe(join(home, 'Library'));
  });

  it('leaves anything without a leading tilde alone', () => {
    expect(expandTilde('/abs/path')).toBe('/abs/path');
    expect(expandTilde('relative/path')).toBe('relative/path');
    expect(expandTilde('~notatilde')).toBe('~notatilde'); // no separator: not a home reference
  });
});

describe('resolveCwd', () => {
  const home = homedir();

  it('returns home for "~"', () => {
    expect(resolveCwd('~')).toBe(home);
  });

  it('returns home for empty / nullish input', () => {
    expect(resolveCwd('')).toBe(home);
    expect(resolveCwd(undefined)).toBe(home);
    expect(resolveCwd(null)).toBe(home);
  });

  it('resolves "~/" against a directory that really exists under home', () => {
    // Created under home rather than tmpdir: only a path below home can be
    // written as "~/<name>", which is what this asserts.
    const dir = mkdtempSync(join(home, 'dmws-cwd-'));
    try {
      expect(resolveCwd(`~/${basename(dir)}`)).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to home for a tilde path that does not exist', () => {
    expect(resolveCwd('~/no-such-dir-dmws-xyz')).toBe(home);
  });

  it('keeps an existing absolute directory unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-cwd-'));
    expect(resolveCwd(dir)).toBe(dir);
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to home for a non-existent directory', () => {
    expect(resolveCwd('/no/such/path/should/exist/xyz')).toBe(home);
  });

  it('falls back to home when the path exists but is not a directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-cwd-'));
    const file = join(dir, 'not-a-dir');
    writeFileSync(file, 'x', 'utf8');
    expect(resolveCwd(file)).toBe(home);
    rmSync(dir, { recursive: true, force: true });
  });
});
