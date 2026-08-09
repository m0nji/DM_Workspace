import { describe, expect, it } from 'vitest';
import {
  buildTaskBody, formatTaskSchedule, templateIdForTask, type TaskFormValues, type Translate
} from '../src/renderer/task-schedule';

// t liefert den Schlüssel zurück, Platzhalter werden angehängt — reicht, um
// die Fallunterscheidung zu prüfen, ohne den echten Katalog mitzuladen
// (dessen Inhalt prüft i18n-catalog.test.ts).
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as Translate;

describe('formatTaskSchedule', () => {
  it('zeigt "Nur manuell" für scheduleKind manual', () => {
    expect(formatTaskSchedule({ scheduleKind: 'manual', scheduleExpr: '' }, t))
      .toBe('tasks.scheduled.schedule.manual');
  });

  it('erkennt die stündliche Vorlage', () => {
    expect(formatTaskSchedule({ scheduleKind: 'cron', scheduleExpr: '0 * * * *' }, t))
      .toBe('tasks.scheduled.schedule.hourly');
  });

  it('erkennt täglich mit Uhrzeit', () => {
    expect(formatTaskSchedule({ scheduleKind: 'cron', scheduleExpr: '0 3 * * *' }, t))
      .toBe('tasks.scheduled.schedule.dailyAt:{"time":"03:00"}');
  });

  // Das Beispiel aus dem Aufgabenbrief: "Montags 03:00".
  it('erkennt wöchentlich montags mit Uhrzeit', () => {
    expect(formatTaskSchedule({ scheduleKind: 'cron', scheduleExpr: '0 3 * * 1' }, t))
      .toBe('tasks.scheduled.schedule.weeklyAt:{"weekday":"tasks.scheduled.schedule.weekday.mon","time":"03:00"}');
  });

  it('normalisiert Sonntag als 7 auf den Index 0', () => {
    expect(formatTaskSchedule({ scheduleKind: 'cron', scheduleExpr: '30 8 * * 7' }, t))
      .toBe('tasks.scheduled.schedule.weeklyAt:{"weekday":"tasks.scheduled.schedule.weekday.sun","time":"08:30"}');
  });

  it('zeigt für nicht erkannte Cron-Ausdrücke NIE den rohen Ausdruck', () => {
    const result = formatTaskSchedule({ scheduleKind: 'cron', scheduleExpr: '*/15 3,7 * * *' }, t);
    expect(result).toBe('tasks.scheduled.schedule.customCronFallback');
    expect(result).not.toContain('*/15');
  });

  it('rundet ein Intervall von 15 Minuten nicht hoch (Beispiel aus dem Brief)', () => {
    expect(formatTaskSchedule({ scheduleKind: 'interval', scheduleExpr: '15' }, t))
      .toBe('tasks.scheduled.schedule.everyMinutes:{"count":15}');
  });

  it('rundet ein Intervall von 60 Minuten auf "jede Stunde" hoch', () => {
    expect(formatTaskSchedule({ scheduleKind: 'interval', scheduleExpr: '60' }, t))
      .toBe('tasks.scheduled.schedule.everyHour');
  });

  it('rundet ein Intervall von 120 Minuten auf "alle 2 Stunden" hoch', () => {
    expect(formatTaskSchedule({ scheduleKind: 'interval', scheduleExpr: '120' }, t))
      .toBe('tasks.scheduled.schedule.everyHours:{"count":2}');
  });

  it('rundet ein Intervall von 1440 Minuten auf "jeden Tag" hoch', () => {
    expect(formatTaskSchedule({ scheduleKind: 'interval', scheduleExpr: '1440' }, t))
      .toBe('tasks.scheduled.schedule.everyDay');
  });

  it('rundet ein Intervall von 2880 Minuten auf "alle 2 Tage" hoch', () => {
    expect(formatTaskSchedule({ scheduleKind: 'interval', scheduleExpr: '2880' }, t))
      .toBe('tasks.scheduled.schedule.everyDays:{"count":2}');
  });

  it('fängt ein ungültiges Intervall ohne rohen Ausdruck ab', () => {
    const result = formatTaskSchedule({ scheduleKind: 'interval', scheduleExpr: 'kaputt' }, t);
    expect(result).toBe('tasks.scheduled.schedule.customCronFallback');
    expect(result).not.toContain('kaputt');
  });
});

describe('templateIdForTask', () => {
  it('erkennt die drei festen Cron-Vorlagen', () => {
    expect(templateIdForTask({ scheduleKind: 'cron', scheduleExpr: '0 * * * *' })).toBe('hourly');
    expect(templateIdForTask({ scheduleKind: 'cron', scheduleExpr: '0 3 * * *' })).toBe('dailyAt3');
    expect(templateIdForTask({ scheduleKind: 'cron', scheduleExpr: '0 3 * * 1' })).toBe('weeklyMonAt3');
  });

  it('fällt bei abweichendem Cron-Ausdruck auf "eigener Cron-Ausdruck" zurück', () => {
    expect(templateIdForTask({ scheduleKind: 'cron', scheduleExpr: '0 4 * * *' })).toBe('customCron');
  });

  it('erkennt interval und manual direkt am scheduleKind', () => {
    expect(templateIdForTask({ scheduleKind: 'interval', scheduleExpr: '30' })).toBe('interval');
    expect(templateIdForTask({ scheduleKind: 'manual', scheduleExpr: '' })).toBe('manual');
  });
});

describe('buildTaskBody', () => {
  const values: TaskFormValues = {
    name: '  Deps  ', agent: 'claude', prompt: 'npm audit', workdir: ' ',
    templateId: 'dailyAt3', intervalMinutes: '15', customCronExpr: '0 3 * * 1',
    timeoutMinutes: '10', enabled: true, ownerId: '', canAssign: false
  };

  it('setzt beim Anlegen die lokale Zeitzone, sonst legt der Server auf Europe/Berlin fest', () => {
    const body = buildTaskBody(values, 'create');
    expect(body.timezone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  // Das Formular hat kein Zeitzonenfeld: ein mitgeschicktes timezone beim
  // Ändern überschriebe still die Zeitzone des Tasks (der Server übernimmt
  // jeden gesetzten Wert) und verschöbe den nächsten Termin — eine
  // Namenskorrektur aus einer anderen Zeitzone verstellte den Zeitplan.
  it('schickt beim Ändern KEINE Zeitzone mit', () => {
    const body = buildTaskBody(values, 'edit');
    expect('timezone' in body).toBe(false);
  });

  it('trimmt Name und Arbeitsverzeichnis und rechnet die Zeitüberschreitung in ms', () => {
    const body = buildTaskBody(values, 'edit');
    expect(body).toMatchObject({
      name: 'Deps', workdir: '.', scheduleKind: 'cron', scheduleExpr: '0 3 * * *',
      agent: 'claude', prompt: 'npm audit', timeoutMs: 600_000, enabled: true
    });
  });

  it('lässt ownerId weg, solange nicht zugewiesen werden darf', () => {
    expect('ownerId' in buildTaskBody({ ...values, ownerId: 'u1' }, 'edit')).toBe(false);
    expect(buildTaskBody({ ...values, ownerId: 'u1', canAssign: true }, 'edit').ownerId).toBe('u1');
    expect(buildTaskBody({ ...values, ownerId: '  ', canAssign: true }, 'edit').ownerId).toBeNull();
  });

  it('nimmt den Ausdruck bei Intervall und eigenem Cron aus dem jeweiligen Feld', () => {
    expect(buildTaskBody({ ...values, templateId: 'interval' }, 'create'))
      .toMatchObject({ scheduleKind: 'interval', scheduleExpr: '15' });
    expect(buildTaskBody({ ...values, templateId: 'customCron' }, 'create'))
      .toMatchObject({ scheduleKind: 'cron', scheduleExpr: '0 3 * * 1' });
  });
});
