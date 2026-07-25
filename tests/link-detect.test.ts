// tests/link-detect.test.ts
import { describe, it, expect } from 'vitest';
import { findLinks, resolveSource, fileTarget, pathEndsWith, isPreviewableFile, isAllowedPreviewUrl } from '../src/shared/link-detect';

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

  it('joins a relative path onto a backslash Windows cwd without mixing separators', () => {
    expect(resolveSource('report.md', 'C:\\Users\\me')).toEqual({ kind: 'markdown', target: 'C:/Users/me/report.md', rel: 'report.md', resolved: true });
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

  // The file browser routes its Preview action through resolveSource, so every
  // markdown flavour isPreviewableFile offers must resolve here too — otherwise
  // the menu entry appears and does nothing.
  it('resolves .markdown and .mdx as markdown', () => {
    expect(resolveSource('/tmp/notes.markdown', '/home/me')).toEqual({ kind: 'markdown', target: '/tmp/notes.markdown', resolved: true });
    expect(resolveSource('/tmp/page.mdx', '/home/me')).toEqual({ kind: 'markdown', target: '/tmp/page.mdx', resolved: true });
  });

  // Terminal output is untrusted, and a link starting with two slashes is a UNC
  // path: on Windows, opening it makes Chromium (webview) or readFileSync
  // (markdown) reach out over SMB to the attacker's host, which auto-negotiates
  // NTLM and hands over the logged-in user's hash. Nothing legitimate needs a
  // remote host here, so no preview source may name one.
  it('refuses a UNC target that would reach out to a remote host', () => {
    expect(resolveSource('//attacker.example/share/report.html', '/home/me')).toBeNull();
    expect(resolveSource('//attacker.example/share/notes.md', '/home/me')).toBeNull();
    expect(resolveSource('\\\\attacker.example\\share\\report.html', '/home/me')).toBeNull();
    // Extra slashes must not slip past the check either.
    expect(resolveSource('///attacker.example/share/x.html', '/home/me')).toBeNull();
  });

  it('still resolves ordinary rooted paths', () => {
    expect(resolveSource('/srv/report.html', '/home/me')).toEqual({ kind: 'web', target: 'file:///srv/report.html', resolved: true });
  });
});

describe('isAllowedPreviewUrl', () => {
  it('allows the schemes the preview can render', () => {
    expect(isAllowedPreviewUrl('https://example.com')).toBe(true);
    expect(isAllowedPreviewUrl('http://example.com')).toBe(true);
    expect(isAllowedPreviewUrl('file:///home/me/out/index.html')).toBe(true);
  });

  it('rejects everything else, including unparseable input', () => {
    expect(isAllowedPreviewUrl('javascript:alert(1)')).toBe(false);
    expect(isAllowedPreviewUrl('data:text/html,<script>1</script>')).toBe(false);
    expect(isAllowedPreviewUrl('not a url')).toBe(false);
  });

  // Last line of defence for the UNC vector above: even if a file: URL naming a
  // remote host reaches the main process, the webview must not attach to it.
  it('rejects a file: URL that names a host', () => {
    expect(isAllowedPreviewUrl('file://attacker.example/share/x.html')).toBe(false);
    expect(isAllowedPreviewUrl('file:////attacker.example/share/x.html')).toBe(false);
    expect(isAllowedPreviewUrl('file://///attacker.example/share/x.html')).toBe(false);
  });
});

describe('isPreviewableFile', () => {
  it('accepts every markdown flavour the preview renders', () => {
    expect(isPreviewableFile('README.md')).toBe(true);
    expect(isPreviewableFile('notes.markdown')).toBe(true);
    expect(isPreviewableFile('page.mdx')).toBe(true);
  });

  it('accepts .html and .htm so the file browser can offer a preview', () => {
    expect(isPreviewableFile('index.html')).toBe(true);
    expect(isPreviewableFile('legacy.htm')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isPreviewableFile('REPORT.HTML')).toBe(true);
    expect(isPreviewableFile('README.MD')).toBe(true);
  });

  it('rejects files the preview has no renderer for', () => {
    expect(isPreviewableFile('notes.txt')).toBe(false);
    expect(isPreviewableFile('package.json')).toBe(false);
    expect(isPreviewableFile('script.ts')).toBe(false);
    expect(isPreviewableFile('archive.html.gz')).toBe(false);
  });

  it('rejects a name that merely contains an extension mid-string', () => {
    expect(isPreviewableFile('mdfile')).toBe(false);
    expect(isPreviewableFile('index.html.bak')).toBe(false);
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
  it('encodes file URL characters that would otherwise break navigation', () => {
    expect(fileTarget('web', '/tmp/My Report #1.html')).toBe('file:///tmp/My%20Report%20%231.html');
  });
  it('normalizes Windows file URLs with encoded path segments', () => {
    expect(fileTarget('web', 'C:\\Users\\me\\My Report #1.html')).toBe('file:///C:/Users/me/My%20Report%20%231.html');
  });
});

describe('pathEndsWith', () => {
  it('matches a bare filename', () => {
    expect(pathEndsWith('/a/b/c/foo.md', 'foo.md')).toBe(true);
  });
  it('matches a multi-segment suffix at a segment boundary', () => {
    expect(pathEndsWith('/a/docs/specs/foo.md', 'specs/foo.md')).toBe(true);
  });
  it('does not match a partial segment', () => {
    expect(pathEndsWith('/a/myspecs/foo.md', 'specs/foo.md')).toBe(false);
  });
  it('does not match when rel is longer than abs', () => {
    expect(pathEndsWith('/foo.md', 'a/b/foo.md')).toBe(false);
  });
  it('tolerates leading/trailing slashes and backslashes', () => {
    expect(pathEndsWith('/a/b/foo.md', '/foo.md')).toBe(true);
    expect(pathEndsWith('C:\\a\\b\\foo.md', 'b/foo.md')).toBe(true);
  });
  it('returns false for empty rel', () => {
    expect(pathEndsWith('/a/foo.md', '')).toBe(false);
  });
});
