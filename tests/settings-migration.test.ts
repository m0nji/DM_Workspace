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

  // Remote-Workspaces: Die Serverliste MUSS den Round-Trip überleben — sonst
  // verlöre jeder Neustart die konfigurierten Server (gleiche Fehlerbauart wie
  // beim brandDesign-Regression oben).
  it('preserves configured servers across a load/save round-trip', () => {
    const out = migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95,
      servers: [{ id: 'srv1', name: 'Dev', baseUrl: 'https://dmw.example/' }]
    });
    expect(out.servers).toEqual([{ id: 'srv1', name: 'Dev', baseUrl: 'https://dmw.example' }]);
  });

  it('drops malformed server entries and duplicate ids, omitting an empty list', () => {
    const out = migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95,
      servers: [
        { id: 'srv1', name: 'Dev', baseUrl: 'https://a.example' },
        { id: 'srv1', name: 'Doppelt', baseUrl: 'https://b.example' },
        { id: 'srv2', name: 'kaputt', baseUrl: 'ftp://x' },
        { id: '', name: 'leer', baseUrl: 'https://c.example' },
        'nope'
      ]
    });
    expect(out.servers).toEqual([{ id: 'srv1', name: 'Dev', baseUrl: 'https://a.example' }]);
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, servers: []
    }).servers).toBeUndefined();
    expect(migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.95, servers: 'nope'
    }).servers).toBeUndefined();
  });

  // Der Laufanzeiger: Art, Farbe und Tempo landen in der Oberflaeche direkt in
  // CSS-Eigenschaften. Was hier durchrutscht, wird nicht noch einmal geprueft.
  it('preserves the busy indicator settings across a round-trip', () => {
    const out = migrateSettings({
      themeId: DEFAULT_THEME_ID, terminalOpacity: 0.9,
      busyIndicator: 'spin', busyIndicatorColor: '#c97b4a', busyIndicatorSpeedMs: 900
    });
    expect(out.busyIndicator).toBe('spin');
    expect(out.busyIndicatorColor).toBe('#c97b4a');
    expect(out.busyIndicatorSpeedMs).toBe(900);
  });

  it('drops an unknown busy indicator kind instead of passing it through', () => {
    // Ein unbekannter Wert waere in der Oberflaeche ein Klassenname ins Leere.
    const out = migrateSettings({ themeId: DEFAULT_THEME_ID, busyIndicator: 'wobble' });
    expect(out.busyIndicator).toBeUndefined();
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, busyIndicator: 7 }).busyIndicator).toBeUndefined();
  });

  it('clamps the busy indicator speed into the supported range', () => {
    const fast = migrateSettings({ themeId: DEFAULT_THEME_ID, busyIndicatorSpeedMs: 5 });
    const slow = migrateSettings({ themeId: DEFAULT_THEME_ID, busyIndicatorSpeedMs: 999999 });
    expect(fast.busyIndicatorSpeedMs).toBe(400);
    expect(slow.busyIndicatorSpeedMs).toBe(4000);
  });

  it('drops a non-numeric or infinite busy indicator speed', () => {
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, busyIndicatorSpeedMs: 'schnell' }).busyIndicatorSpeedMs)
      .toBeUndefined();
    expect(migrateSettings({ themeId: DEFAULT_THEME_ID, busyIndicatorSpeedMs: Infinity }).busyIndicatorSpeedMs)
      .toBeUndefined();
  });

  it('leaves the busy indicator out entirely when it was never configured', () => {
    // Fehlt das Feld, bleibt es weg statt als 'off' dazustehen — ein Bestand
    // vor diesem Feature sieht danach exakt aus wie vorher.
    const out = migrateSettings({ themeId: DEFAULT_THEME_ID, terminalOpacity: 0.9 });
    expect('busyIndicator' in out).toBe(false);
    expect('busyIndicatorColor' in out).toBe(false);
    expect('busyIndicatorSpeedMs' in out).toBe(false);
  });
});


describe('terminal font size migration', () => {
  it('preserves a chosen size and clamps finite sizes to a readable range', () => {
    expect(migrateSettings({ terminalFontSize: 18 }).terminalFontSize).toBe(18);
    expect(migrateSettings({ terminalFontSize: 0 }).terminalFontSize).toBe(10);
    expect(migrateSettings({ terminalFontSize: 100 }).terminalFontSize).toBe(32);
    expect(migrateSettings({ terminalFontSize: 15.7 }).terminalFontSize).toBe(16);
  });
  it('omits malformed sizes so the default applies', () => {
    for (const terminalFontSize of [undefined, null, '18', Infinity, NaN]) {
      expect(migrateSettings({ terminalFontSize }).terminalFontSize).toBeUndefined();
    }
  });
});
