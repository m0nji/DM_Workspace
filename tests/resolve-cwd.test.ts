import { describe, it, expect } from 'vitest';
import { homedir } from 'os';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveCwd } from '../src/main/resolve-cwd';

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

  it('expands a leading "~/" to a path under home', () => {
    expect(resolveCwd('~/')).toBe(home);
    // "~/Library" exists on macOS; assert it expands under home regardless
    expect(resolveCwd('~/Library')).toBe(join(home, 'Library'));
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
