// tests/link-detect.test.ts
import { describe, it, expect } from 'vitest';
import { findLinks, resolveSource } from '../src/shared/link-detect';

describe('findLinks', () => {
  it('finds an http(s) URL in a line', () => {
    const links = findLinks('see https://example.com/page for details');
    expect(links).toEqual([{ text: 'https://example.com/page', startIndex: 4, length: 24 }]);
  });

  it('finds a relative .md path', () => {
    const links = findLinks('wrote ./report.md done');
    expect(links).toEqual([{ text: './report.md', startIndex: 6, length: 11 }]);
  });

  it('finds .html and .htm paths', () => {
    expect(findLinks('open out/index.html').map((l) => l.text)).toEqual(['out/index.html']);
    expect(findLinks('open a.htm').map((l) => l.text)).toEqual(['a.htm']);
  });

  it('ignores plain words without a target extension or scheme', () => {
    expect(findLinks('nothing to see here')).toEqual([]);
  });
});

describe('resolveSource', () => {
  it('classifies an http URL as web with the raw target', () => {
    expect(resolveSource('https://example.com', '/home/me')).toEqual({ kind: 'web', target: 'https://example.com' });
  });

  it('resolves a relative .md path against the cwd to an absolute fs path', () => {
    expect(resolveSource('./report.md', '/home/me/proj')).toEqual({ kind: 'markdown', target: '/home/me/proj/report.md' });
  });

  it('keeps an absolute .md path as-is', () => {
    expect(resolveSource('/tmp/a.md', '/home/me')).toEqual({ kind: 'markdown', target: '/tmp/a.md' });
  });

  it('resolves a relative .html path to a file:// url', () => {
    expect(resolveSource('out/index.html', '/home/me')).toEqual({ kind: 'web', target: 'file:///home/me/out/index.html' });
  });

  it('returns null for an unsupported target', () => {
    expect(resolveSource('notes.txt', '/home/me')).toBeNull();
  });
});
