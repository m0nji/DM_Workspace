// tests/link-detect.test.ts
import { describe, it, expect } from 'vitest';
import { findLinks, resolveSource, fileTarget, candidateBases } from '../src/shared/link-detect';

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

  it('does not include a wrapping parenthesis (markdown link style)', () => {
    expect(findLinks('see [docs](report.md) here').map((l) => l.text)).toEqual(['report.md']);
  });

  it('strips trailing punctuation from a URL', () => {
    const links = findLinks('visit https://example.com/page.');
    expect(links).toEqual([{ text: 'https://example.com/page', startIndex: 6, length: 24 }]);
  });
});

describe('resolveSource', () => {
  it('classifies an http URL as web, resolved, with the raw target', () => {
    expect(resolveSource('https://example.com', '/home/me')).toEqual({ kind: 'web', target: 'https://example.com', resolved: true });
  });

  it('resolves a relative .md path against the cwd and records rel', () => {
    expect(resolveSource('./report.md', '/home/me/proj')).toEqual({ kind: 'markdown', target: '/home/me/proj/report.md', rel: './report.md', resolved: true });
  });

  it('keeps an absolute .md path as-is, no rel', () => {
    expect(resolveSource('/tmp/a.md', '/home/me')).toEqual({ kind: 'markdown', target: '/tmp/a.md', resolved: true });
  });

  it('resolves a relative .html path to a file:// url and records rel', () => {
    expect(resolveSource('out/index.html', '/home/me')).toEqual({ kind: 'web', target: 'file:///home/me/out/index.html', rel: 'out/index.html', resolved: true });
  });

  it('returns null for an unsupported target', () => {
    expect(resolveSource('notes.txt', '/home/me')).toBeNull();
  });
});

describe('fileTarget', () => {
  it('returns an absolute path unchanged for markdown', () => {
    expect(fileTarget('markdown', '/a/b.md')).toBe('/a/b.md');
  });
  it('wraps a path in a file:// url for web', () => {
    expect(fileTarget('web', '/a/b.html')).toBe('file:///a/b.html');
  });
  it('adds a leading slash before file:// when missing', () => {
    expect(fileTarget('web', 'a/b.html')).toBe('file:///a/b.html');
  });
});

describe('candidateBases', () => {
  it('orders cwd, then direct subdirs, then roots', () => {
    expect(candidateBases('/p', ['DM_Workspace', 'other'], ['/r1'])).toEqual([
      '/p', '/p/DM_Workspace', '/p/other', '/r1'
    ]);
  });
  it('strips a trailing slash from cwd and roots and dedups', () => {
    expect(candidateBases('/p/', ['sub'], ['/p', '/r/'])).toEqual(['/p', '/p/sub', '/r']);
  });
  it('works with no subdirs and no roots', () => {
    expect(candidateBases('/p', [], [])).toEqual(['/p']);
  });
});
