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

// ---- Zeitplan-Vorlagen fürs Formular ---------------------------------------

export type ScheduleTemplateId = 'hourly' | 'dailyAt3' | 'weeklyMonAt3' | 'interval' | 'customCron' | 'manual';

export interface ScheduleTemplateDef {
  id: ScheduleTemplateId;
  scheduleKind: RemoteTask['scheduleKind'];
  // Fester Ausdruck bei den drei Cron-Vorlagen und bei "manual" (leer); bei
  // Intervall/eigenem Cron gibt der Nutzer den Ausdruck selbst ein (null).
  fixedExpr: string | null;
}

const CRON_TEMPLATE_EXPR: Record<'hourly' | 'dailyAt3' | 'weeklyMonAt3', string> = {
  hourly: '0 * * * *',
  dailyAt3: '0 3 * * *',
  weeklyMonAt3: '0 3 * * 1'
};

// Reihenfolge bestimmt die Reihenfolge der <option>-Einträge im Formular.
export const SCHEDULE_TEMPLATES: ScheduleTemplateDef[] = [
  { id: 'hourly', scheduleKind: 'cron', fixedExpr: CRON_TEMPLATE_EXPR.hourly },
  { id: 'dailyAt3', scheduleKind: 'cron', fixedExpr: CRON_TEMPLATE_EXPR.dailyAt3 },
  { id: 'weeklyMonAt3', scheduleKind: 'cron', fixedExpr: CRON_TEMPLATE_EXPR.weeklyMonAt3 },
  { id: 'interval', scheduleKind: 'interval', fixedExpr: null },
  { id: 'customCron', scheduleKind: 'cron', fixedExpr: null },
  { id: 'manual', scheduleKind: 'manual', fixedExpr: '' }
];

export function scheduleTemplate(id: ScheduleTemplateId): ScheduleTemplateDef {
  return SCHEDULE_TEMPLATES.find((tpl) => tpl.id === id)!;
}

/** Welche Vorlage passt zu einem bestehenden Task — Grundlage fürs Vorbelegen beim Bearbeiten. */
export function templateIdForTask(task: Pick<RemoteTask, 'scheduleKind' | 'scheduleExpr'>): ScheduleTemplateId {
  if (task.scheduleKind === 'manual') return 'manual';
  if (task.scheduleKind === 'interval') return 'interval';
  const expr = task.scheduleExpr.trim();
  const fixed = (Object.keys(CRON_TEMPLATE_EXPR) as (keyof typeof CRON_TEMPLATE_EXPR)[])
    .find((id) => CRON_TEMPLATE_EXPR[id] === expr);
  return fixed ?? 'customCron';
}

// ---- Anfrage-Body des Formulars ---------------------------------------------

/** Rohwerte des Formulars (Eingabefelder sind Text, auch die Zahlen). */
export interface TaskFormValues {
  name: string;
  agent: RemoteTask['agent'];
  prompt: string;
  workdir: string;
  templateId: ScheduleTemplateId;
  intervalMinutes: string;
  customCronExpr: string;
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
  const tpl = scheduleTemplate(values.templateId);
  const scheduleExpr =
    values.templateId === 'interval' ? values.intervalMinutes.trim()
    : values.templateId === 'customCron' ? values.customCronExpr.trim()
    : tpl.fixedExpr ?? '';
  const body: Record<string, unknown> = {
    name: values.name.trim(),
    agent: values.agent,
    prompt: values.prompt,
    workdir: values.workdir.trim() || '.',
    scheduleKind: tpl.scheduleKind,
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
