// Output-activity indicator, not a process/task completion detector.
// A local prompt reliably clears it. Otherwise raw output determines activity;
// the historical status `done` means an output pause. Silent commands can still
// run and waiting TUIs can repaint. UI copy must preserve this distinction.

import type { PaneShellState, PaneStatus } from './types';

export function isPaneRunning(
  shell: PaneShellState | undefined,
  status: PaneStatus | undefined
): boolean {
  if (shell === 'atPrompt') return false;
  return status === 'busy';
}

/**
 * Zeigt Ausgabeaktivität, sobald mindestens eine Pane neue Ausgabe sendet.
 */
export function workspaceRunning(
  paneIds: readonly string[],
  shell: Readonly<Record<string, PaneShellState>>,
  status: Readonly<Record<string, PaneStatus>>
): boolean {
  return paneIds.some((id) => isPaneRunning(shell[id], status[id]));
}
