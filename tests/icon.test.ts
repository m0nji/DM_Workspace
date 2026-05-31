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
