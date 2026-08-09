import type { RemoteTaskError } from '../shared/types';
import type { Translate } from './task-schedule';

// Fehlertexte der geplanten Agenten-Tasks. Reine Logik, aus dem Panel gelöst —
// dasselbe Muster wie command-list.ts und task-schedule.ts: die Übersetzung
// wird hereingereicht, damit sich die Regel ohne React/jsdom prüfen lässt.

// Server-Fehlercode (kebab-case, RemoteTaskErrorCode) auf den passenden
// i18n-Schlüssel (camelCase) abgebildet, statt per Template-Literal-Schlüssel
// zusammenzusetzen — 'not-logged-in'/'not-found' sind sonst keine gültigen
// JS-Objektpfade und würden die generierten i18next-Schlüsseltypen verfehlen.
const ERROR_TEXT_KEYS = {
  'not-logged-in': 'tasks.scheduled.error.notLoggedIn',
  forbidden: 'tasks.scheduled.error.forbidden',
  'not-found': 'tasks.scheduled.error.notFound',
  conflict: 'tasks.scheduled.error.conflict',
  invalid: 'tasks.scheduled.error.invalid',
  network: 'tasks.scheduled.error.network',
  server: 'tasks.scheduled.error.server'
} as const;

/** Übersetzter Katalogtext zu einem Fehlercode (unbekannter Code → „Serverfehler"). */
export function errorText(code: string, t: Translate): string {
  const key = Object.prototype.hasOwnProperty.call(ERROR_TEXT_KEYS, code)
    ? ERROR_TEXT_KEYS[code as keyof typeof ERROR_TEXT_KEYS]
    : ERROR_TEXT_KEYS.server;
  return t(key);
}

/**
 * Fehlertext einer fehlgeschlagenen Aktion: die Servermeldung 1:1 (der Server
 * liefert für Menschen lesbare Sätze), mit der übersetzten Meldung aus dem
 * Katalog als Netz, falls keine mitkommt.
 *
 * Auch 'conflict' zeigt die Servermeldung. Der Server kennt dort ZWEI Fälle
 * (tasks/routes.ts): "Im Projekt läuft bereits ein Lauf" beim Starten und
 * "Task hat einen laufenden Lauf – erst abbrechen oder abwarten" beim Ändern
 * und Löschen. Ein fester Text passte immer nur auf einen davon — beim
 * Löschen erschien die falsche Formulierung, samt fehlender
 * Handlungsanweisung.
 *
 * Dass „Servermeldung vorziehen" nie technischen oder fest deutschen Text vor
 * den Nutzer bringt, hängt an einer Zusage der Gegenseite: `message` wird
 * ausschließlich aus dem `error`-Feld einer Serverantwort gefüllt
 * (remote-tasks.ts, RemoteTaskError in shared/types.ts). Deshalb braucht es
 * hier KEINE Ausnahmeliste für 'network' und 'server' — beide kommen ohne
 * message an und fallen von selbst auf den Katalogtext.
 */
export function describeTaskError(res: RemoteTaskError, t: Translate): string {
  return res.message?.trim() || errorText(res.code, t);
}
