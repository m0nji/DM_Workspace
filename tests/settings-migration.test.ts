import { describe, it, expect } from 'vitest';
import { migrateSettings, defaultSettings } from '../src/main/persistence';
import { DEFAULT_THEME_ID } from '../src/shared/themes';

describe('migrateSettings', () => {
  it('maps a pre-theme state to the default theme, keeping opacity and preserving the custom background as an override', () => {
    const out = migrateSettings({ terminalBackground: '#101418', terminalOpacity: 0.5 });
    expect(out).toEqual({
      themeId: DEFAULT_THEME_ID,
      terminalOpacity: 0.5,
      terminalBackground: '#101418',
      workspaceNavigationPlacement: 'left'
    });
  });

  it('keeps a valid themeId', () => {
    const out = migrateSettings({ themeId: 'dracula', terminalOpacity: 0.9 });
    expect(out).toEqual({ themeId: 'dracula', terminalOpacity: 0.9, workspaceNavigationPlacement: 'left' });
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

  it('keeps valid shortcut overrides and drops unknown/invalid ones', () => {
    const out = migrateSettings({
      themeId: DEFAULT_THEME_ID,
      terminalOpacity: 0.75,
      shortcutBindings: {
        commandPalette: 'Mod+Alt+P',
        missing: 'Mod+X',
        openSettings: 42
      }
    });
    expect(out.shortcutBindings).toEqual({ commandPalette: 'Mod+Alt+P' });
  });

  it('omits shortcutBindings entirely when none are valid', () => {
    const out = migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.75, shortcutBindings: { nope: 1 } });
    expect(out.shortcutBindings).toBeUndefined();
  });

  it('keeps valid workspace navigation placement values', () => {
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID,
      terminalOpacity: 0.75,
      workspaceNavigationPlacement: 'left'
    }).workspaceNavigationPlacement).toBe('left');
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID,
      terminalOpacity: 0.75,
      workspaceNavigationPlacement: 'top'
    }).workspaceNavigationPlacement).toBe('top');
  });

  it('drops invalid workspace navigation placement values to the default left placement', () => {
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID,
      terminalOpacity: 0.95,
      workspaceNavigationPlacement: 'floating'
    })).toEqual(defaultSettings());
  });

  // Regression: these fields used to be dropped on load, so the user's choice
  // reverted (to Black Utility / OS language) on every launch and the next save
  // then persisted the stripped settings — losing the choice permanently.
  it('preserves the persisted brand design across a load/save round-trip', () => {
    for (const design of ['graphite', 'standard', 'black'] as const) {
      expect(migrateSettings({
        themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, brandDesign: design
      }).brandDesign).toBe(design);
    }
  });

  it('omits an invalid brand design so the renderer default (graphite) applies', () => {
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, brandDesign: 'neon'
    }).brandDesign).toBeUndefined();
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95 }).brandDesign).toBeUndefined();
  });

  it('preserves the persisted locale and drops invalid values', () => {
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, locale: 'de' }).locale).toBe('de');
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, locale: 'en' }).locale).toBe('en');
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, locale: 'fr' }).locale).toBeUndefined();
  });

  it('preserves clickMovesCursor', () => {
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, clickMovesCursor: true }).clickMovesCursor).toBe(true);
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, clickMovesCursor: 'yes' }).clickMovesCursor).toBeUndefined();
  });

  // Regression-Schutz in der Bauart des brandDesign-Fehlers: würde das Feld hier
  // durchfallen, käme der Verlauf nach jedem Start ungefragt zurück und der
  // nächste Save überschriebe die Wahl des Nutzers dauerhaft.
  it('preserves restoreTerminalHistory across a load/save round-trip', () => {
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, restoreTerminalHistory: false
    }).restoreTerminalHistory).toBe(false);
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, restoreTerminalHistory: true
    }).restoreTerminalHistory).toBe(true);
  });

  it('omits a non-boolean restoreTerminalHistory so the default (on) applies', () => {
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, restoreTerminalHistory: 'yes'
    }).restoreTerminalHistory).toBeUndefined();
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95
    }).restoreTerminalHistory).toBeUndefined();
  });
});
