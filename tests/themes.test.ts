import { describe, it, expect } from 'vitest';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, getTheme } from '../src/shared/themes';

describe('themes', () => {
  it('has a default theme present in the list', () => {
    expect(BUILTIN_THEMES.some((t) => t.id === DEFAULT_THEME_ID)).toBe(true);
  });

  it('every theme has exactly 16 ansi colors', () => {
    for (const t of BUILTIN_THEMES) expect(t.ansi).toHaveLength(16);
  });

  it('getTheme returns the requested theme', () => {
    expect(getTheme('dracula')?.id).toBe('dracula');
  });

  it('getTheme falls back to the default for an unknown id', () => {
    expect(getTheme('nope')?.id).toBe(DEFAULT_THEME_ID);
  });
});
