import { describe, it, expect } from 'vitest';
import { parseChangelog } from '../src/shared/changelog';

describe('parseChangelog', () => {
  it('parses versions, dates and feat/fix/other entries', () => {
    const md = `# Changelog

## 0.7.15 – 2026-06-13
- feat: Bilder per Drag & Drop ins Terminal ziehen
- fix: Fenster-Auswahl wird nicht mehr abgeschnitten
- Kleinere Aufräumarbeiten

## 0.7.14 – 2026-06-11
- feat: Bilder per Ctrl+V einfügen
`;
    const versions = parseChangelog(md);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toEqual({
      version: '0.7.15',
      date: '2026-06-13',
      entries: [
        { kind: 'feat', text: 'Bilder per Drag & Drop ins Terminal ziehen' },
        { kind: 'fix', text: 'Fenster-Auswahl wird nicht mehr abgeschnitten' },
        { kind: 'other', text: 'Kleinere Aufräumarbeiten' }
      ]
    });
    expect(versions[1].version).toBe('0.7.14');
    expect(versions[1].entries[0]).toEqual({ kind: 'feat', text: 'Bilder per Ctrl+V einfügen' });
  });

  it('keeps versions in document order (newest first as written)', () => {
    const md = `## 2.0.0\n- feat: B\n\n## 1.0.0\n- fix: A\n`;
    expect(parseChangelog(md).map((v) => v.version)).toEqual(['2.0.0', '1.0.0']);
  });

  it('accepts v-prefix, [brackets] and various date separators', () => {
    const md = `## [v1.2.3] - 2026-01-02\n- feat: X\n`;
    const v = parseChangelog(md)[0];
    expect(v.version).toBe('1.2.3');
    expect(v.date).toBe('2026-01-02');
  });

  it('treats "feature:" and "bugfix:" as feat/fix and is case-insensitive', () => {
    const md = `## 1.0.0\n- Feature: A\n- BugFix: B\n- FIX: C\n`;
    expect(parseChangelog(md)[0].entries.map((e) => e.kind)).toEqual(['feat', 'fix', 'fix']);
  });

  it('handles a version with no date', () => {
    const md = `## 0.1.0\n- feat: first\n`;
    const v = parseChangelog(md)[0];
    expect(v.version).toBe('0.1.0');
    expect(v.date).toBeUndefined();
  });

  it('ignores entries before the first version heading and blank lines', () => {
    const md = `# Changelog\n\nSome intro text.\n- feat: orphan (ignored)\n\n## 1.0.0\n- fix: real\n`;
    const versions = parseChangelog(md);
    expect(versions).toHaveLength(1);
    expect(versions[0].entries).toEqual([{ kind: 'fix', text: 'real' }]);
  });

  it('returns an empty array for empty or heading-less input', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('just some prose\nwith no headings')).toEqual([]);
  });
});
