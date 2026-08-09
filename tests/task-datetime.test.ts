import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../src/renderer/task-datetime';

describe('formatDateTime', () => {
  const iso = '2026-08-09T21:23:31.000Z';

  it('folgt der eingestellten App-Sprache, nicht der des Betriebssystems', () => {
    // Der eigentliche Fehler: `toLocaleString()` ohne Argument nimmt die
    // OS-Sprache. Auf einem englischsprachigen macOS stand dadurch
    // "8/9/2026, 11:23:31 PM" mitten in einer deutschen Oberfläche.
    const de = formatDateTime(iso, 'de');
    const en = formatDateTime(iso, 'en');

    expect(de).not.toBe(en);
    // Deutsch: Punkte als Datumstrenner, 24-Stunden-Uhr.
    expect(de).toMatch(/^\d{2}\.\d{2}\.\d{4}, \d{2}:\d{2}:\d{2}$/);
    expect(de).not.toMatch(/AM|PM/);
    // Englisch: Schrägstriche und 12-Stunden-Uhr.
    expect(en).toMatch(/^\d{2}\/\d{2}\/\d{4}, /);
    expect(en).toMatch(/AM|PM/);
  });

  it('zeigt für einen fehlenden Zeitpunkt einen Gedankenstrich', () => {
    expect(formatDateTime(null, 'de')).toBe('—');
    expect(formatDateTime(null, 'en')).toBe('—');
  });

  it('nimmt auch eine Sprache mit Regionsteil entgegen, ohne zu werfen', () => {
    // i18next liefert je nach Erkennung 'de' oder 'de-AT'.
    expect(() => formatDateTime(iso, 'de-AT')).not.toThrow();
    expect(formatDateTime(iso, 'de-AT')).toMatch(/^\d{2}\.\d{2}\.\d{4}, /);
  });

  it('fällt bei unbekannter Sprache auf Englisch zurück, statt zu werfen', () => {
    expect(() => formatDateTime(iso, 'kauderwelsch')).not.toThrow();
    expect(formatDateTime(iso, 'kauderwelsch')).toBe(formatDateTime(iso, 'en'));
  });
});
