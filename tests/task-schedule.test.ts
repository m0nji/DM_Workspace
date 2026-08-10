import { describe, expect, it } from 'vitest';
import {
  buildSchedule, buildTaskBody, DEFAULT_SCHEDULE_PARTS, formatTaskSchedule, parseSchedule,
  type ScheduleParts, type TaskFormValues, type Translate
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

  it('erkennt eine stündliche Vorlage mit abweichender Minute', () => {
    expect(formatTaskSchedule({ scheduleKind: 'cron', scheduleExpr: '20 * * * *' }, t))
      .toBe('tasks.scheduled.schedule.hourlyAt:{"minute":"20"}');
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

describe('buildTaskBody', () => {
  const values: TaskFormValues = {
    name: '  Deps  ', agent: 'claude', prompt: 'npm audit', workdir: ' ',
    schedule: { ...DEFAULT_SCHEDULE_PARTS, frequency: 'daily', time: '03:00' },
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

  it('nimmt den Ausdruck aus der gewählten Frequenz', () => {
    expect(buildTaskBody({ ...values, schedule: { ...values.schedule, frequency: 'interval', intervalMinutes: '15' } }, 'create'))
      .toMatchObject({ scheduleKind: 'interval', scheduleExpr: '15' });
    expect(buildTaskBody({ ...values, schedule: { ...values.schedule, frequency: 'weekly', weekday: 2, time: '03:00' } }, 'create'))
      .toMatchObject({ scheduleKind: 'cron', scheduleExpr: '0 3 * * 2' });
  });
});

describe('parseSchedule', () => {
  it('zerlegt die stündliche Form samt Minute', () => {
    expect(parseSchedule({ scheduleKind: 'cron', scheduleExpr: '20 * * * *' }))
      .toMatchObject({ frequency: 'hourly', minute: '20' });
  });

  it('zerlegt die tägliche Form in eine Uhrzeit', () => {
    expect(parseSchedule({ scheduleKind: 'cron', scheduleExpr: '5 7 * * *' }))
      .toMatchObject({ frequency: 'daily', time: '07:05' });
  });

  // Der Kern des Auftrags: ein gespeicherter Dienstag muss als Dienstag
  // wieder im Formular erscheinen, nicht als roher Ausdruck.
  it('zerlegt die wöchentliche Form in Wochentag und Uhrzeit', () => {
    expect(parseSchedule({ scheduleKind: 'cron', scheduleExpr: '0 3 * * 2' }))
      .toMatchObject({ frequency: 'weekly', weekday: 2, time: '03:00' });
  });

  it('normalisiert den Sonntag von 7 auf 0, wie formatTaskSchedule es auch tut', () => {
    expect(parseSchedule({ scheduleKind: 'cron', scheduleExpr: '30 8 * * 7' }))
      .toMatchObject({ frequency: 'weekly', weekday: 0, time: '08:30' });
  });

  it('erkennt Intervall und "nur manuell" am scheduleKind', () => {
    expect(parseSchedule({ scheduleKind: 'interval', scheduleExpr: '30' }))
      .toMatchObject({ frequency: 'interval', intervalMinutes: '30' });
    expect(parseSchedule({ scheduleKind: 'manual', scheduleExpr: '' }))
      .toMatchObject({ frequency: 'manual' });
  });

  // Ohne diesen Rückfall verlöre ein Task seinen Zeitplan, sobald jemand das
  // Formular öffnet und speichert.
  it('behält einen nicht zerlegbaren Ausdruck wörtlich als eigenen Cron-Ausdruck', () => {
    for (const expr of ['*/15 3 * * *', '0 3 * * 1,4', '0 3 1 * *', '0 3 * 6 *', 'kaputt']) {
      expect(parseSchedule({ scheduleKind: 'cron', scheduleExpr: expr }))
        .toMatchObject({ frequency: 'customCron', cronExpr: expr });
    }
  });
});

describe('buildSchedule', () => {
  const parts = (over: Partial<ScheduleParts>): ScheduleParts => ({ ...DEFAULT_SCHEDULE_PARTS, ...over });

  it('setzt die sechs Frequenzen in Ausdrücke um', () => {
    expect(buildSchedule(parts({ frequency: 'hourly', minute: '20' })))
      .toEqual({ scheduleKind: 'cron', scheduleExpr: '20 * * * *' });
    expect(buildSchedule(parts({ frequency: 'daily', time: '07:05' })))
      .toEqual({ scheduleKind: 'cron', scheduleExpr: '5 7 * * *' });
    expect(buildSchedule(parts({ frequency: 'weekly', weekday: 2, time: '03:00' })))
      .toEqual({ scheduleKind: 'cron', scheduleExpr: '0 3 * * 2' });
    expect(buildSchedule(parts({ frequency: 'interval', intervalMinutes: '45' })))
      .toEqual({ scheduleKind: 'interval', scheduleExpr: '45' });
    expect(buildSchedule(parts({ frequency: 'manual' })))
      .toEqual({ scheduleKind: 'manual', scheduleExpr: '' });
    expect(buildSchedule(parts({ frequency: 'customCron', cronExpr: '  */15 3 * * *  ' })))
      .toEqual({ scheduleKind: 'cron', scheduleExpr: '*/15 3 * * *' });
  });

  it('fängt unsinnige Eingaben ab, statt einen kaputten Ausdruck zu bauen', () => {
    expect(buildSchedule(parts({ frequency: 'hourly', minute: '' })).scheduleExpr).toBe('0 * * * *');
    expect(buildSchedule(parts({ frequency: 'hourly', minute: '99' })).scheduleExpr).toBe('59 * * * *');
    expect(buildSchedule(parts({ frequency: 'daily', time: 'unfug' })).scheduleExpr).toBe('0 3 * * *');
    expect(buildSchedule(parts({ frequency: 'interval', intervalMinutes: '0' })).scheduleExpr).toBe('1');
    expect(buildSchedule(parts({ frequency: 'interval', intervalMinutes: '99999' })).scheduleExpr).toBe('10080');
  });
});

describe('parseSchedule/buildSchedule als Rundreise', () => {
  it('gibt jeden erzeugbaren Ausdruck unverändert zurück', () => {
    const cases: { scheduleKind: 'cron' | 'interval' | 'manual'; scheduleExpr: string }[] = [
      { scheduleKind: 'cron', scheduleExpr: '0 * * * *' },
      { scheduleKind: 'cron', scheduleExpr: '20 * * * *' },
      { scheduleKind: 'cron', scheduleExpr: '0 3 * * *' },
      { scheduleKind: 'cron', scheduleExpr: '5 7 * * *' },
      { scheduleKind: 'cron', scheduleExpr: '0 3 * * 2' },
      { scheduleKind: 'cron', scheduleExpr: '30 8 * * 0' },
      { scheduleKind: 'cron', scheduleExpr: '*/15 3 * * *' },
      { scheduleKind: 'interval', scheduleExpr: '45' },
      { scheduleKind: 'manual', scheduleExpr: '' }
    ];
    for (const c of cases) expect(buildSchedule(parseSchedule(c))).toEqual(c);
  });

  // Was der Editor erzeugt, muss die Liste als Klartext lesen können — sonst
  // stünde dort „Benutzerdefiniert", obwohl der Nutzer eine Vorlage gewählt hat.
  it('erzeugt nur Ausdrücke, die formatTaskSchedule als Klartext erkennt', () => {
    const t = ((key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as Translate;
    const built = [
      buildSchedule({ ...DEFAULT_SCHEDULE_PARTS, frequency: 'hourly', minute: '0' }),
      buildSchedule({ ...DEFAULT_SCHEDULE_PARTS, frequency: 'hourly', minute: '20' }),
      buildSchedule({ ...DEFAULT_SCHEDULE_PARTS, frequency: 'daily', time: '07:05' }),
      buildSchedule({ ...DEFAULT_SCHEDULE_PARTS, frequency: 'weekly', weekday: 2, time: '03:00' })
    ];
    for (const b of built) {
      expect(formatTaskSchedule(b, t)).not.toBe('tasks.scheduled.schedule.customCronFallback');
    }
  });
});
