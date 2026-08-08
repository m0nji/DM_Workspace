import { describe, expect, it } from 'vitest';
import { ICON_PATHS, ICON_VIEWBOX, type IconName } from '../src/renderer/components/Icon';

const REQUIRED: IconName[] = [
  'command-palette', 'settings', 'preview', 'search',
  'back', 'forward', 'reload', 'folder', 'close'
];

describe('icon registry', () => {
  it('uses a single 24×24 viewBox for every icon', () => {
    expect(ICON_VIEWBOX).toBe('0 0 24 24');
  });

  it('defines a non-empty path list for every required icon', () => {
    for (const name of REQUIRED) {
      expect(ICON_PATHS[name], `missing icon: ${name}`).toBeDefined();
      expect(ICON_PATHS[name].length).toBeGreaterThan(0);
      for (const d of ICON_PATHS[name]) expect(typeof d).toBe('string');
    }
  });
});

describe('file-browser icons', () => {
  it('defines non-empty paths for the new icons', () => {
    for (const name of ['folder-open', 'file-code', 'file-text', 'file-config', 'chevron-down', 'file-plus', 'save'] as const) {
      expect(Array.isArray(ICON_PATHS[name])).toBe(true);
      expect(ICON_PATHS[name].length).toBeGreaterThan(0);
    }
  });
});

describe('remote icon', () => {
  it('definiert nicht-leere Pfade für das Server-Icon', () => {
    expect(ICON_PATHS.server).toBeDefined();
    expect(ICON_PATHS.server.length).toBeGreaterThan(0);
    for (const d of ICON_PATHS.server) expect(typeof d).toBe('string');
  });
});
