// Maps paneId -> a function that clears that pane's terminal buffer (and
// persists the cleared state, so a restart doesn't replay the old scrollback).
// Lets the context menu clear panes other than the one it was opened on — e.g.
// "Clear all windows" — without prop-drilling each Terminal instance.
const registry = new Map<string, () => void>();

export function registerTerminal(paneId: string, clear: () => void): void {
  registry.set(paneId, clear);
}

export function unregisterTerminal(paneId: string): void {
  registry.delete(paneId);
}

export function clearTerminal(paneId: string): void {
  registry.get(paneId)?.();
}

export function clearTerminals(paneIds: string[]): void {
  for (const id of paneIds) registry.get(id)?.();
}
