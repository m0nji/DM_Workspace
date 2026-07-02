import { describe, expect, it } from 'vitest';
import { breadcrumbSegments, parentDir, basename, isFsRoot } from '../src/shared/fs-path';

describe('breadcrumbSegments (posix)', () => {
  it('splits an absolute path into cumulative crumbs', () => {
    expect(breadcrumbSegments('/Users/me/code')).toEqual([
      { label: '/', path: '/' },
      { label: 'Users', path: '/Users' },
      { label: 'me', path: '/Users/me' },
      { label: 'code', path: '/Users/me/code' }
    ]);
  });

  it('returns a single root crumb for /', () => {
    expect(breadcrumbSegments('/')).toEqual([{ label: '/', path: '/' }]);
  });

  it('ignores a trailing slash', () => {
    expect(breadcrumbSegments('/a/b/')).toEqual([
      { label: '/', path: '/' },
      { label: 'a', path: '/a' },
      { label: 'b', path: '/a/b' }
    ]);
  });
});

describe('breadcrumbSegments (windows)', () => {
  it('splits a backslash drive path into cumulative crumbs', () => {
    expect(breadcrumbSegments('C:\\Users\\me')).toEqual([
      { label: 'C:', path: 'C:/' },
      { label: 'Users', path: 'C:/Users' },
      { label: 'me', path: 'C:/Users/me' }
    ]);
  });

  it('handles forward-slash drive paths (normalized OSC cwd)', () => {
    expect(breadcrumbSegments('C:/Users/me')).toEqual([
      { label: 'C:', path: 'C:/' },
      { label: 'Users', path: 'C:/Users' },
      { label: 'me', path: 'C:/Users/me' }
    ]);
  });

  it('returns a single crumb for a drive root', () => {
    expect(breadcrumbSegments('C:\\')).toEqual([{ label: 'C:', path: 'C:/' }]);
    expect(breadcrumbSegments('C:/')).toEqual([{ label: 'C:', path: 'C:/' }]);
  });
});

describe('parentDir', () => {
  it('returns the parent of an absolute path', () => {
    expect(parentDir('/a/b/c')).toBe('/a/b');
  });
  it('stops at the root', () => {
    expect(parentDir('/a')).toBe('/');
    expect(parentDir('/')).toBe('/');
  });
  it('walks up a Windows path regardless of separator', () => {
    expect(parentDir('C:\\Users\\me')).toBe('C:/Users');
    expect(parentDir('C:/Users/me')).toBe('C:/Users');
  });
  it('stops at the drive root and keeps its trailing slash', () => {
    expect(parentDir('C:/Users')).toBe('C:/');
    expect(parentDir('C:\\')).toBe('C:/');
    expect(parentDir('C:/')).toBe('C:/');
  });
});

describe('isFsRoot', () => {
  it('recognizes the posix root', () => {
    expect(isFsRoot('/')).toBe(true);
    expect(isFsRoot('/a')).toBe(false);
  });
  it('recognizes Windows drive roots in any spelling', () => {
    expect(isFsRoot('C:/')).toBe(true);
    expect(isFsRoot('C:\\')).toBe(true);
    expect(isFsRoot('C:')).toBe(true);
    expect(isFsRoot('C:/Users')).toBe(false);
    expect(isFsRoot('C:\\Users')).toBe(false);
  });
});

describe('basename', () => {
  it('returns the last segment (posix or windows separator)', () => {
    expect(basename('/a/b/file.txt')).toBe('file.txt');
    expect(basename('C:\\Users\\me\\f.md')).toBe('f.md');
  });
});
