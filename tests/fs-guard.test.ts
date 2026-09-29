import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join, parse } from 'node:path';
import { assertFsPath, assertDeletablePath, FsGuardError } from '../src/main/fs-guard';

describe('assertFsPath', () => {
  it('expands ~ and accepts ordinary absolute paths', () => {
    expect(assertFsPath('~')).toBe(homedir());
    expect(assertFsPath(join(homedir(), 'x'))).toBe(join(homedir(), 'x'));
  });

  it('rejects anything that is not a plain local path', () => {
    for (const bad of [undefined, null, 42, {}, '/tmp/a\0b', '\\\\evil\\share', '//evil/share', '\\\\evil\\share\\x.md']) {
      expect(() => assertFsPath(bad)).toThrow(FsGuardError);
    }
  });
});

describe('assertDeletablePath', () => {
  // expandTilde('') und expandTilde('~') liefern das Home-Verzeichnis — ohne
  // diese Prüfung legt fs:delete das ganze Home in den Papierkorb.
  it('refuses paths that resolve to the home directory or the filesystem root', () => {
    const home = homedir();
    for (const bad of ['', '   ', '~', '~/', '~\\', home, `${home}/`, parse(home).root]) {
      expect(() => assertDeletablePath(bad), JSON.stringify(bad)).toThrow(FsGuardError);
    }
  });

  it('refuses relative paths', () => {
    expect(() => assertDeletablePath('notes/a.md')).toThrow(FsGuardError);
    expect(() => assertDeletablePath('./a.md')).toThrow(FsGuardError);
  });

  it('refuses non-strings and UNC paths', () => {
    expect(() => assertDeletablePath(undefined)).toThrow(FsGuardError);
    expect(() => assertDeletablePath('\\\\evil\\share\\x')).toThrow(FsGuardError);
  });

  it('accepts a file below the home directory', () => {
    const file = join(homedir(), 'projekt', 'a.md');
    expect(assertDeletablePath(file)).toBe(file);
    expect(assertDeletablePath('~/projekt/a.md')).toBe(file);
  });
});
