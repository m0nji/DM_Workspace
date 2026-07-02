import { describe, it, expect } from 'vitest';
import { parseOsc7, parseOsc9 } from '../src/shared/osc-cwd';

describe('parseOsc7', () => {
  it('extracts a POSIX path from a file:// URL', () => {
    expect(parseOsc7('file://myhost/Users/m0nji/Documents')).toBe('/Users/m0nji/Documents');
  });

  it('decodes percent-encoded characters (e.g. spaces)', () => {
    expect(parseOsc7('file://host/Users/me/My%20Projects')).toBe('/Users/me/My Projects');
  });

  it('handles an empty host (file:///path)', () => {
    expect(parseOsc7('file:///home/me')).toBe('/home/me');
  });

  it('strips the leading slash before a Windows drive letter', () => {
    expect(parseOsc7('file:///C:/Users/m0nji')).toBe('C:/Users/m0nji');
  });

  it('accepts a bare absolute path as a fallback', () => {
    expect(parseOsc7('/var/log')).toBe('/var/log');
  });

  it('normalizes a bare Windows path to forward slashes', () => {
    expect(parseOsc7('C:\\Users\\m0nji')).toBe('C:/Users/m0nji');
  });

  it('returns null for empty or non-path payloads', () => {
    expect(parseOsc7('')).toBeNull();
    expect(parseOsc7('not-a-path')).toBeNull();
  });
});

describe('parseOsc9', () => {
  it('extracts a Windows path from a 9;<path> payload, normalized to forward slashes', () => {
    expect(parseOsc9('9;C:\\Users\\m0nji\\Documents')).toBe('C:/Users/m0nji/Documents');
  });

  it('extracts a POSIX path', () => {
    expect(parseOsc9('9;/Users/m0nji')).toBe('/Users/m0nji');
  });

  it('keeps a backslash in a POSIX path intact (no drive prefix)', () => {
    expect(parseOsc9('9;/Users/me/weird\\name')).toBe('/Users/me/weird\\name');
  });

  it('trims surrounding whitespace', () => {
    expect(parseOsc9('9; C:\\tmp ')).toBe('C:/tmp');
  });

  it('returns null when the sub-identifier is not 9', () => {
    expect(parseOsc9('4;some-other-osc')).toBeNull();
  });

  it('returns null for empty payloads', () => {
    expect(parseOsc9('')).toBeNull();
    expect(parseOsc9('9;')).toBeNull();
  });
});
