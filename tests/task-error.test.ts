import { describe, expect, it, vi } from 'vitest';
import { describeTaskError, errorText } from '../src/renderer/task-error';
import { RemoteTasks } from '../src/main/remote/remote-tasks';
import type { Translate } from '../src/renderer/task-schedule';

// t liefert den Schlüssel zurück — reicht, um zu prüfen, WELCHER Katalogtext
// gezogen wird, ohne den Katalog mitzuladen (dessen Inhalt prüft
// i18n-catalog.test.ts). Gleiches Vorgehen wie in task-schedule.test.ts.
const t = ((key: string) => key) as unknown as Translate;

describe('describeTaskError', () => {
  it('zeigt die Servermeldung, wenn eine mitkam', () => {
    expect(describeTaskError({ ok: false, code: 'invalid', message: 'Name: 1–80 Zeichen' }, t))
      .toBe('Name: 1–80 Zeichen');
  });

  // Der Server kennt zwei 409-Fälle ("Im Projekt läuft bereits ein Lauf" beim
  // Starten, "Task hat einen laufenden Lauf – erst abbrechen oder abwarten"
  // beim Ändern/Löschen). Ein fester Text passte immer nur auf einen davon.
  it('zeigt auch bei conflict die Servermeldung statt eines festen Textes', () => {
    expect(describeTaskError({ ok: false, code: 'conflict', message: 'Task hat einen laufenden Lauf – erst abbrechen oder abwarten' }, t))
      .toBe('Task hat einen laufenden Lauf – erst abbrechen oder abwarten');
  });

  it('fällt ohne Servermeldung auf den Katalogtext zurück', () => {
    expect(describeTaskError({ ok: false, code: 'network' }, t)).toBe('tasks.scheduled.error.network');
    expect(describeTaskError({ ok: false, code: 'server' }, t)).toBe('tasks.scheduled.error.server');
    expect(describeTaskError({ ok: false, code: 'forbidden', message: '   ' }, t)).toBe('tasks.scheduled.error.forbidden');
  });

  it('bildet unbekannte Codes auf den Serverfehler-Text ab', () => {
    expect(errorText('voellig-neu', t)).toBe('tasks.scheduled.error.server');
  });
});

// Die Zusage „message enthält nur echte Servermeldungen" (remote-tasks.ts)
// und die Anzeigeregel (describeTaskError) hängen zusammen: bricht eine der
// beiden, liest der Nutzer technischen oder fest deutschen Text an genau der
// Stelle, an der die Liste leer bleibt. Deshalb hier beide Hälften am Stück,
// mit dem echten REST-Client statt einem nachgebauten Ergebnis.
describe('Kette REST-Client → Anzeigetext', () => {
  it('ein nicht erreichbarer Server ergibt "Server nicht erreichbar", nicht die fetch-Ausnahme', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('fetch failed'))) as unknown as typeof fetch;
    const api = new RemoteTasks({
      resolve: () => ({ baseUrl: 'https://dmw.example', cookie: 'dmw_session=abc' }),
      fetchFn
    });

    const res = await api.list('srv1', 'proj1');
    expect(res.ok).toBe(false);
    expect(describeTaskError(res as { ok: false; code: 'network' }, t)).toBe('tasks.scheduled.error.network');
  });

  it('eine unerwartete Antwortform ergibt den übersetzten Serverfehler, keinen deutschen Festtext', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(new Response('<html>502</html>', {
      status: 200, headers: { 'Content-Type': 'text/html' }
    }))) as unknown as typeof fetch;
    const api = new RemoteTasks({
      resolve: () => ({ baseUrl: 'https://dmw.example', cookie: 'dmw_session=abc' }),
      fetchFn
    });

    const res = await api.list('srv1', 'proj1');
    expect(res.ok).toBe(false);
    expect(describeTaskError(res as { ok: false; code: 'server' }, t)).toBe('tasks.scheduled.error.server');
  });
});
