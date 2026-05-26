import { describe, it, expect } from 'vitest';
import { migrateSettings, defaultSettings } from '../src/main/persistence';
import { DEFAULT_THEME_ID } from '../src/shared/themes';

describe('migrateSettings', () => {
  it('maps a pre-theme state (terminalBackground only) to the default theme, keeping opacity', () => {
    const out = migrateSettings({ terminalBackground: '#1e1e1e', terminalOpacity: 0.5 });
    expect(out).toEqual({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.5 });
  });

  it('keeps a valid themeId', () => {
    const out = migrateSettings({ themeId: 'dracula', terminalOpacity: 0.9 });
    expect(out).toEqual({ themeId: 'dracula', terminalOpacity: 0.9 });
  });

  it('falls back to defaults for an unknown themeId or missing opacity', () => {
    expect(migrateSettings({ themeId: 'nope' })).toEqual(defaultSettings());
  });

  it('returns defaults for non-object input', () => {
    expect(migrateSettings(null)).toEqual(defaultSettings());
  });
});
