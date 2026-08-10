import type { TFunction } from 'i18next';
import type { RemoteTask } from '../shared/types';

// Übersetzung wird hereingereicht statt importiert — wie in command-list.ts,
// damit sich die reine Formatierungslogik ohne React/jsdom testen lässt.
export type Translate = TFunction;

// Wochentags-Schlüssel, indiziert wie Cron's `day-of-week`-Feld (0 = Sonntag,
// … , 6 = Samstag; 7 wird vom Aufrufer auf 0 normalisiert). Als Tupel statt
// dynamischem Template-Key `weekday.${n}`, damit die i18next-Schlüsseltypen
// (aus en.json generiert) den Zugriff ohne `as`-Cast durchwinken — das Indizieren
// eines `as const`-Tupels mit einer `number` ergibt die Vereinigung der
// Elementtypen, exakt die zulässigen Schlüssel.
const WEEKDAY_KEYS = [
  'tasks.scheduled.schedule.weekday.sun',
  'tasks.scheduled.schedule.weekday.mon',
  'tasks.scheduled.schedule.weekday.tue',
  'tasks.scheduled.schedule.weekday.wed',
  'tasks.scheduled.schedule.weekday.thu',
  'tasks.scheduled.schedule.weekday.fri',
  'tasks.scheduled.schedule.weekday.sat'
] as const;

// Cron-Ausdruck in Klartext übersetzen. Portiert 1:1 die Erkennung aus dem
// Web-Client (DM_Workspace_Web/web/src/views/TasksPanel.tsx, scheduleText) —
// nur einzelne feste Werte oder '*' je Feld, keine Listen/Schritte/Bereiche.
// EINE Abweichung vom Vorbild ist Absicht: Der Web-Client zeigt einen nicht
// erkannten Ausdruck als "Benutzerdefiniert (<Ausdruck>)" — genau der rohe
// Cron-Text, den Aufgabe 4 aus der Desktop-Oberfläche verbannt. Hier gibt es
// für diesen Fall stattdessen eine feste, übersetzte Ausweichmeldung.
function formatCron(expr: string, t: Translate): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
    if (dayOfMonth === '*' && month === '*') {
      if (minute === '0' && hour === '*' && dayOfWeek === '*') {
        return t('tasks.scheduled.schedule.hourly');
      }
      // Eine abweichende Minute ist seit dem Frequenz-Editor erreichbar
      // ("Stündlich, Minute 20"). Ohne diesen Zweig läse die Liste einen vom
      // Formular selbst erzeugten Ausdruck als "Eigener Zeitplan".
      if (hour === '*' && dayOfWeek === '*' && /^\d{1,2}$/.test(minute) && Number(minute) <= 59) {
        return t('tasks.scheduled.schedule.hourlyAt', { minute: minute.padStart(2, '0') });
      }
      if (/^\d+$/.test(minute) && /^\d+$/.test(hour)) {
        const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
        if (dayOfWeek === '*') return t('tasks.scheduled.schedule.dailyAt', { time });
        if (/^[0-7]$/.test(dayOfWeek)) {
          const idx = dayOfWeek === '7' ? 0 : Number(dayOfWeek);
          return t('tasks.scheduled.schedule.weeklyAt', { weekday: t(WEEKDAY_KEYS[idx]), time });
        }
      }
    }
  }
  return t('tasks.scheduled.schedule.customCronFallback');
}

// Intervall in Minuten in Klartext — rundet sichtbar auf Tage/Stunden hoch
// (ebenfalls aus dem Web-Client übernommen), sonst läse ein 1440-Minuten-Task
// als "Alle 1440 Minuten" statt "Jeden Tag".
function formatInterval(expr: string, t: Translate): string {
  const minutes = Number(expr);
  if (!Number.isFinite(minutes) || minutes <= 0) return t('tasks.scheduled.schedule.customCronFallback');
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? t('tasks.scheduled.schedule.everyDay') : t('tasks.scheduled.schedule.everyDays', { count: days });
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? t('tasks.scheduled.schedule.everyHour') : t('tasks.scheduled.schedule.everyHours', { count: hours });
  }
  return t('tasks.scheduled.schedule.everyMinutes', { count: minutes });
}

/** Zeitplan eines Tasks als Klartext (nie als roher Cron-Ausdruck, Vorgabe Aufgabe 4). */
export function formatTaskSchedule(task: Pick<RemoteTask, 'scheduleKind' | 'scheduleExpr'>, t: Translate): string {
  if (task.scheduleKind === 'manual') return t('tasks.scheduled.schedule.manual');
  if (task.scheduleKind === 'interval') return formatInterval(task.scheduleExpr, t);
  return formatCron(task.scheduleExpr, t);
}

// ---- Zeitplan-Modell fürs Formular ------------------------------------------
//
// Das Formular führt nicht mehr feste Vorlagen ("Wöchentlich, montags 03:00"),
// sondern eine Frequenz plus die dazugehörigen, frei anpassbaren Felder. Der
// Cron-Ausdruck wird daraus erzeugt statt aus einer Tabelle gelesen — sonst
// bliebe jede Abweichung von der Vorlage (Dienstag statt Montag) nur über den
// rohen Ausdruck erreichbar, den die Oberfläche gerade vermeiden soll.

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'interval' | 'manual' | 'customCron';

/** Reihenfolge der <option>-Einträge im Formular. */
export const SCHEDULE_FREQUENCIES: readonly ScheduleFrequency[] =
  ['hourly', 'daily', 'weekly', 'interval', 'manual', 'customCron'] as const;

export interface ScheduleParts {
  frequency: ScheduleFrequency;
  /** Minute bei 'hourly'. Text, weil es direkt am Eingabefeld hängt. */
  minute: string;
  /** 'HH:MM' bei 'daily' und 'weekly' — das Format von <input type="time">. */
  time: string;
  /** Cron-Wochentag bei 'weekly': 0 = Sonntag … 6 = Samstag. */
  weekday: number;
  /** Minuten bei 'interval'. */
  intervalMinutes: string;
  /** Roher Ausdruck bei 'customCron'. */
  cronExpr: string;
}

// Vorgabe für einen neuen Task: täglich 03:00, wie bisher. Die übrigen Felder
// sind sinnvolle Startwerte, sobald jemand die Frequenz wechselt — deshalb
// trägt jedes Feld einen Wert, nicht nur das der Vorgabe-Frequenz.
export const DEFAULT_SCHEDULE_PARTS: ScheduleParts = {
  frequency: 'daily',
  minute: '0',
  time: '03:00',
  weekday: 1,
  intervalMinutes: '15',
  cronExpr: '0 3 * * 1'
};

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw.trim());
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** 'HH:MM' zerlegen; alles Unbrauchbare fällt auf 03:00 zurück (die Vorgabe). */
function splitTime(time: string): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return { hour: 3, minute: 0 };
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return { hour: 3, minute: 0 };
  return { hour, minute };
}

function joinTime(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Gespeicherten Zeitplan in die Formularfelder zerlegen.
 *
 * Erkannt wird genau das, was `formatCron` oben auch als Klartext liest:
 * einzelne feste Werte, Tag-des-Monats und Monat auf '*'. Alles andere
 * (Listen, Schritte, Bereiche, gesetzter Monatstag) landet WÖRTLICH in
 * `cronExpr` unter der Frequenz 'customCron'. Ohne diesen Rückfall verlöre ein
 * von Hand gepflegter Ausdruck beim bloßen Öffnen und Speichern des Formulars
 * seine Bedeutung.
 */
export function parseSchedule(task: Pick<RemoteTask, 'scheduleKind' | 'scheduleExpr'>): ScheduleParts {
  if (task.scheduleKind === 'manual') return { ...DEFAULT_SCHEDULE_PARTS, frequency: 'manual' };
  if (task.scheduleKind === 'interval') {
    return { ...DEFAULT_SCHEDULE_PARTS, frequency: 'interval', intervalMinutes: task.scheduleExpr.trim() };
  }
  const expr = task.scheduleExpr.trim();
  const custom: ScheduleParts = { ...DEFAULT_SCHEDULE_PARTS, frequency: 'customCron', cronExpr: expr };
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return custom;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts as [string, string, string, string, string];
  if (dayOfMonth !== '*' || month !== '*') return custom;
  if (!/^\d{1,2}$/.test(minute) || Number(minute) > 59) return custom;

  if (hour === '*' && dayOfWeek === '*') {
    return { ...DEFAULT_SCHEDULE_PARTS, frequency: 'hourly', minute: String(Number(minute)) };
  }
  if (!/^\d{1,2}$/.test(hour) || Number(hour) > 23) return custom;
  const time = joinTime(Number(hour), Number(minute));
  if (dayOfWeek === '*') return { ...DEFAULT_SCHEDULE_PARTS, frequency: 'daily', time };
  if (!/^[0-7]$/.test(dayOfWeek)) return custom;
  // Cron kennt den Sonntag als 0 und als 7; die Oberfläche führt ihn nur als 0
  // (dieselbe Normalisierung wie in formatCron oben).
  const weekday = dayOfWeek === '7' ? 0 : Number(dayOfWeek);
  return { ...DEFAULT_SCHEDULE_PARTS, frequency: 'weekly', weekday, time };
}

/** Formularfelder in die beiden API-Felder umsetzen — Gegenstück zu parseSchedule. */
export function buildSchedule(parts: ScheduleParts): { scheduleKind: RemoteTask['scheduleKind']; scheduleExpr: string } {
  switch (parts.frequency) {
    case 'hourly':
      return { scheduleKind: 'cron', scheduleExpr: `${clampInt(parts.minute, 0, 59, 0)} * * * *` };
    case 'daily': {
      const { hour, minute } = splitTime(parts.time);
      return { scheduleKind: 'cron', scheduleExpr: `${minute} ${hour} * * *` };
    }
    case 'weekly': {
      const { hour, minute } = splitTime(parts.time);
      const day = clampInt(String(parts.weekday), 0, 6, 1);
      return { scheduleKind: 'cron', scheduleExpr: `${minute} ${hour} * * ${day}` };
    }
    case 'interval':
      // Dieselben Grenzen wie das Eingabefeld (1 Minute bis 1 Woche).
      return { scheduleKind: 'interval', scheduleExpr: String(clampInt(parts.intervalMinutes, 1, 10080, 15)) };
    case 'manual':
      return { scheduleKind: 'manual', scheduleExpr: '' };
    default:
      return { scheduleKind: 'cron', scheduleExpr: parts.cronExpr.trim() };
  }
}

// ---- Anfrage-Body des Formulars ---------------------------------------------

/** Rohwerte des Formulars (Eingabefelder sind Text, auch die Zahlen). */
export interface TaskFormValues {
  name: string;
  agent: RemoteTask['agent'];
  prompt: string;
  workdir: string;
  schedule: ScheduleParts;
  timeoutMinutes: string;
  enabled: boolean;
  ownerId: string;
  /** access.canAssign des Servers — nur dann darf ownerId überhaupt mit. */
  canAssign: boolean;
}

/**
 * Baut den Body für POST (anlegen) bzw. PATCH (ändern). Rein und ohne React,
 * damit die Feldauswahl testbar bleibt (wie formatTaskSchedule oben).
 *
 * `mode` entscheidet über die Zeitzone, und das ist der Kern dieser Funktion:
 * Das Formular hat KEIN Zeitzonenfeld. Beim Anlegen muss die lokale Zeitzone
 * mit, sonst legt der Server den Task auf sein Vorgabe-'Europe/Berlin'
 * (server/src/tasks/schedule.ts), egal wo die Nutzerin sitzt. Beim Ändern
 * darf sie NICHT mit: der Server übernimmt jeden mitgeschickten Wert
 * (parseTaskBody in tasks/routes.ts) und rechnet den nächsten Termin neu —
 * eine Namenskorrektur durch eine Kollegin in Singapur verschöbe einen Task
 * „täglich 03:00 Europe/Berlin" unsichtbar auf 03:00 Singapur-Zeit. Das Feld
 * wegzulassen ist dabei genauer als task.timezone zurückzuschicken: PATCH
 * übernimmt nur gesetzte Felder, ein zwischenzeitlich anderswo geänderter
 * Wert wird so nicht mit einem beim Öffnen des Formulars gelesenen Stand
 * überschrieben.
 */
export function buildTaskBody(values: TaskFormValues, mode: 'create' | 'edit'): Record<string, unknown> {
  const { scheduleKind, scheduleExpr } = buildSchedule(values.schedule);
  const body: Record<string, unknown> = {
    name: values.name.trim(),
    agent: values.agent,
    prompt: values.prompt,
    workdir: values.workdir.trim() || '.',
    scheduleKind,
    scheduleExpr,
    timeoutMs: Math.max(1, Math.round(Number(values.timeoutMinutes) || 1)) * 60_000,
    enabled: values.enabled
  };
  if (mode === 'create') body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  // ownerId nur mitschicken, wenn überhaupt zuweisbar — der Server lehnt
  // JEDEN Body mit ownerId-Feld ab, wenn die anfragende Person nicht
  // Projekt-Owner ist, selbst bei ownerId: null (siehe parseTaskBody).
  if (values.canAssign) body.ownerId = values.ownerId.trim() || null;
  return body;
}
