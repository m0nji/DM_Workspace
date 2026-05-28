import { describe, it, expect } from 'vitest';
import { migrateSettings, defaultSettings } from '../src/main/persistence';
import { DEFAULT_THEME_ID } from '../src/shared/themes';

describe('migrateSettings', () => {
  it('maps a pre-theme state to the default theme, keeping opacity and preserving the custom background as an override', () => {
    const out = migrateSettings({ terminalBackground: '#101418', terminalOpacity: 0.5 });
    expect(out).toEqual({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.5, terminalBackground: '#101418' });
  });

  it('keeps a valid themeId', () => {
    const out = migrateSettings({ themeId: 'dracula', terminalOpacity: 0.9 });
    expect(out).toEqual({ themeId: 'dracula', terminalOpacity: 0.9 });
  });

  it('falls back to defaults for an unknown themeId or missing opacity', () => {
    expect(migrateSettings({ themeId: 'nope' })).toEqual(defaultSettings());
  });

  it('clamps persisted opacity into the supported range', () => {
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 10 }).terminalOpacity).toBe(1);
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: -1 }).terminalOpacity).toBe(0);
  });

  it('returns defaults for non-object input', () => {
    expect(migrateSettings(null)).toEqual(defaultSettings());
  });
});
