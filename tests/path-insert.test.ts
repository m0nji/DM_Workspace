import { describe, it, expect } from 'vitest';
import { formatPathsForInsert } from '../src/shared/path-insert';

describe('formatPathsForInsert (POSIX)', () => {
  it('leaves a simple path untouched, with a trailing space', () => {
    expect(formatPathsForInsert(['/Users/me/img.png'], 'darwin')).toBe('/Users/me/img.png ');
  });

  it('backslash-escapes spaces', () => {
    expect(formatPathsForInsert(['/Users/me/My Photos/a.png'], 'darwin'))
      .toBe('/Users/me/My\\ Photos/a.png ');
  });

  it('escapes shell-special characters', () => {
    expect(formatPathsForInsert(["/tmp/x(1)&'.png"], 'linux'))
      .toBe("/tmp/x\\(1\\)\\&\\'.png ");
  });

  it('joins multiple paths with a single space and one trailing space', () => {
    expect(formatPathsForInsert(['/a/one.png', '/a/two.png'], 'darwin'))
      .toBe('/a/one.png /a/two.png ');
  });
});

describe('formatPathsForInsert (Windows)', () => {
  it('leaves a space-free path untouched, with a trailing space', () => {
    expect(formatPathsForInsert(['C:\\Users\\me\\img.png'], 'win32'))
      .toBe('C:\\Users\\me\\img.png ');
  });

  it('double-quotes a path containing a space', () => {
    expect(formatPathsForInsert(['C:\\Users\\me\\My Pics\\a.png'], 'win32'))
      .toBe('"C:\\Users\\me\\My Pics\\a.png" ');
  });

  it('does not backslash-escape on Windows (backslashes are path separators)', () => {
    expect(formatPathsForInsert(['C:\\a\\b.png'], 'win32')).toBe('C:\\a\\b.png ');
  });

  it('quotes paths containing shell metacharacters even without spaces', () => {
    expect(formatPathsForInsert(['C:\\Users\\me\\report&calc;.png'], 'win32'))
      .toBe('"C:\\Users\\me\\report&calc;.png" ');
  });

  it('escapes embedded double quotes inside quoted Windows paths', () => {
    expect(formatPathsForInsert(['C:\\Users\\me\\bad"name.png'], 'win32'))
      .toBe('"C:\\Users\\me\\bad`"name.png" ');
  });

  it('quotes and backtick-escapes $ so PowerShell does not interpolate it', () => {
    expect(formatPathsForInsert(['C:\\temp\\$env.txt'], 'win32'))
      .toBe('"C:\\temp\\`$env.txt" ');
  });

  it('quotes and doubles a backtick (the PowerShell escape char)', () => {
    expect(formatPathsForInsert(['C:\\temp\\a`b.txt'], 'win32'))
      .toBe('"C:\\temp\\a``b.txt" ');
  });
});

describe('formatPathsForInsert (edge cases)', () => {
  it('returns an empty string for no paths', () => {
    expect(formatPathsForInsert([], 'darwin')).toBe('');
    expect(formatPathsForInsert([], 'win32')).toBe('');
  });

  it('skips empty entries', () => {
    expect(formatPathsForInsert(['', '/a/b.png', ''], 'darwin')).toBe('/a/b.png ');
  });
});
