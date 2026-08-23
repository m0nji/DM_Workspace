// Arbeitet in dieser Pane noch etwas? Rein und ohne jsdom testbar, damit die
// Antwort an genau einer Stelle steht und nicht in der Navigation nachgebaut
// wird (Muster: tab-drop-intent.ts, workspace-groups.ts).
//
// Die Frage lautet ausdruecklich: "passiert dort noch was, oder ist eine
// Eingabe des Nutzers faellig?" — nicht "ist dort ein Programm offen".
//
// Zwei Quellen, und sie beantworten verschiedene Haelften:
//
//  * PaneShellState 'atPrompt' ist die einzige Auskunft, der wir absolut
//    trauen: die Shell selbst meldet ueber den privaten Prompt-Marker, dass sie
//    wieder frei ist. Das kann die Heuristik nicht wissen, und deshalb schlaegt
//    dieser Wert alles andere.
//
//  * 'running' heisst dagegen nur "seit dem letzten Prompt wurde eine Zeile
//    abgeschickt". Ueber laufende Arbeit sagt das nichts: bei jedem
//    interaktiven Unterprogramm — Claude Code, Codex, ssh, ein REPL, tmux —
//    bleibt es vom Start bis zum Ende stehen, auch waehrend das Programm auf
//    eine Eingabe wartet. An echten Sitzungen gemessen: ein wartender Agent
//    meldet 'running', obwohl genau dann eine Eingabe faellig ist. Als Antwort
//    auf "laeuft gerade etwas" ist der Wert damit unbrauchbar.
//
//  * Also entscheidet die Heuristik aus pane-activity.ts, ob gerade gearbeitet
//    wird: Ausgabe -> busy, zwei Sekunden Stille -> done. Ein arbeitender Agent
//    schreibt laufend, ein wartender schweigt — genau die gesuchte Grenze.
//
// Der Preis ist bekannt und bewusst gezahlt: ein Kommando, das laenger als zwei
// Sekunden schweigt (ein leiser Build), gilt als fertig. Der Fehler in die
// andere Richtung waere teurer gewesen — wer in fast jeder Pane eine
// Agenten-Sitzung offen hat, haette sonst dauerhaft jedes Register markiert,
// und eine Anzeige, die immer an ist, beantwortet nichts mehr.

import type { PaneShellState, PaneStatus } from './types';

export function isPaneRunning(
  shell: PaneShellState | undefined,
  status: PaneStatus | undefined
): boolean {
  if (shell === 'atPrompt') return false;
  return status === 'busy';
}

/**
 * Arbeitet in einem Register noch etwas? Wahr, sobald EINE seiner Panes laeuft —
 * die Anzeige beantwortet "hier ist noch etwas offen", nicht "wie viel".
 */
export function workspaceRunning(
  paneIds: readonly string[],
  shell: Readonly<Record<string, PaneShellState>>,
  status: Readonly<Record<string, PaneStatus>>
): boolean {
  return paneIds.some((id) => isPaneRunning(shell[id], status[id]));
}
