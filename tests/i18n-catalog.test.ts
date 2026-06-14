import { describe, it, expect } from 'vitest';
import en from '../src/renderer/i18n/en.json';
import de from '../src/renderer/i18n/de.json';

/** Flatten nested keys into dot-paths: { a: { b: 1 } } -> ['a.b']. */
function keys(obj: unknown, prefix = ''): string[] {
  if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
    return Object.entries(obj as Record<string, unknown>).flatMap(
      ([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k)
    );
  }
  return [prefix];
}

describe('i18n catalogs', () => {
  it('en and de have identical key sets', () => {
    const enKeys = keys(en).sort();
    const deKeys = keys(de).sort();
    const missingInDe = enKeys.filter((k) => !deKeys.includes(k));
    const missingInEn = deKeys.filter((k) => !enKeys.includes(k));
    expect({ missingInDe, missingInEn }).toEqual({ missingInDe: [], missingInEn: [] });
  });

  it('no value is an empty string', () => {
    const values = (obj: unknown): string[] =>
      obj && typeof obj === 'object'
        ? Object.values(obj as Record<string, unknown>).flatMap(values)
        : [String(obj)];
    expect(values(en).every((v) => v.length > 0)).toBe(true);
    expect(values(de).every((v) => v.length > 0)).toBe(true);
  });

  it('interpolation placeholders match between en and de', () => {
    const flat = (obj: unknown, prefix = ''): [string, string][] =>
      obj && typeof obj === 'object' && !Array.isArray(obj)
        ? Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
            flat(v, prefix ? `${prefix}.${k}` : k)
          )
        : [[prefix, String(obj)]];
    const ph = (s: string): string[] =>
      (s.match(/\{\{\s*[\w]+\s*\}\}/g) ?? []).map((x) => x.replace(/\s/g, '')).sort();
    const enMap = Object.fromEntries(flat(en));
    const deMap = Object.fromEntries(flat(de));
    const mismatches = Object.keys(enMap)
      .filter((k) => k in deMap)
      .map((k) => ({ key: k, en: ph(enMap[k]), de: ph(deMap[k]) }))
      .filter(({ en, de }) => JSON.stringify(en) !== JSON.stringify(de));
    expect(mismatches).toEqual([]);
  });
});
