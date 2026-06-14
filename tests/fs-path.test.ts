import { describe, expect, it } from 'vitest';
import { breadcrumbSegments, parentDir, basename } from '../src/shared/fs-path';

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

describe('parentDir', () => {
  it('returns the parent of an absolute path', () => {
    expect(parentDir('/a/b/c')).toBe('/a/b');
  });
  it('stops at the root', () => {
    expect(parentDir('/a')).toBe('/');
    expect(parentDir('/')).toBe('/');
  });
});

describe('basename', () => {
  it('returns the last segment (posix or windows separator)', () => {
    expect(basename('/a/b/file.txt')).toBe('file.txt');
    expect(basename('C:\\Users\\me\\f.md')).toBe('f.md');
  });
});
