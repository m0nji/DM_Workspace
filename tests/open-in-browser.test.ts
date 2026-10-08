import { describe, expect, it, vi } from 'vitest';
import { createOpenInBrowser } from '../src/main/open-in-browser';

function services(platform: NodeJS.Platform = 'linux', files: string[] = ['/proj/out/report.html']) {
  return {
    platform,
    openExternal: vi.fn(() => Promise.resolve()),
    isFile: vi.fn((p: string) => files.includes(p)),
    defaultBrowserApp: vi.fn(() => Promise.resolve('/Applications/Safari.app' as string | null)),
    openWithApp: vi.fn(() => Promise.resolve())
  };
}

describe('openInBrowser', () => {
  it('opens http(s) URLs in the system browser', async () => {
    const s = services();
    const open = createOpenInBrowser(s);
    expect(await open('https://example.com/a?b=1#c')).toBe(true);
    expect(s.openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/a?b=1#c');
  });

  it('opens an existing local html file via its file URL', async () => {
    const s = services();
    const open = createOpenInBrowser(s);
    expect(await open('file:///proj/out/report.html')).toBe(true);
    expect(s.openExternal).toHaveBeenCalledExactlyOnceWith('file:///proj/out/report.html');
  });

  it('on macOS hands the file to the default browser app, not the .html file handler', async () => {
    const s = services('darwin');
    const open = createOpenInBrowser(s);
    expect(await open('file:///proj/out/report.html')).toBe(true);
    expect(s.openWithApp).toHaveBeenCalledExactlyOnceWith('/Applications/Safari.app', '/proj/out/report.html');
    expect(s.openExternal).not.toHaveBeenCalled();
  });

  it('on macOS falls back to the file handler when no default browser is known', async () => {
    const s = services('darwin');
    s.defaultBrowserApp.mockResolvedValueOnce(null);
    const open = createOpenInBrowser(s);
    expect(await open('file:///proj/out/report.html')).toBe(true);
    expect(s.openExternal).toHaveBeenCalledExactlyOnceWith('file:///proj/out/report.html');
  });

  it.each([
    ['missing file', 'file:///proj/out/missing.html'],
    ['non-html file', 'file:///proj/out/secret.txt'],
    ['UNC host', 'file://server/share/x.html'],
    ['UNC via empty host', 'file:////server/share/x.html'],
    ['other scheme', 'smb://server/x.html'],
    ['javascript', 'javascript:alert(1)'],
    ['garbage', 'not a url'],
    ['non-string', 42]
  ])('refuses %s', async (_label, raw) => {
    const s = services('linux', ['/proj/out/secret.txt']);
    const open = createOpenInBrowser(s);
    expect(await open(raw)).toBe(false);
    expect(s.openExternal).not.toHaveBeenCalled();
    expect(s.openWithApp).not.toHaveBeenCalled();
  });
});
