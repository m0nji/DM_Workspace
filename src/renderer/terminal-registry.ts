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

const focusRegistry = new Map<string, () => void>();
export function registerTerminalFocus(paneId: string, focus: () => void): void { focusRegistry.set(paneId, focus); }
export function unregisterTerminalFocus(paneId: string): void { focusRegistry.delete(paneId); }
export function focusTerminal(paneId: string): void { focusRegistry.get(paneId)?.(); }

// A programmatic split/close can resize a terminal before ResizeObserver has
// delivered a trustworthy final measurement. TerminalView registers an atomic
// fit + PTY resize + repaint callback so layout actions can explicitly settle it.
const layoutRefreshRegistry = new Map<string, () => void>();
export function registerTerminalLayoutRefresh(paneId: string, refresh: () => void): void {
  layoutRefreshRegistry.set(paneId, refresh);
}
export function unregisterTerminalLayoutRefresh(paneId: string): void {
  layoutRefreshRegistry.delete(paneId);
}
export function refreshTerminalLayout(paneId: string): void {
  layoutRefreshRegistry.get(paneId)?.();
}
export function refreshTerminalLayoutAfterCommit(paneId: string): void {
  if (typeof requestAnimationFrame !== 'function') {
    // Store unit tests run without a browser frame scheduler. There is no
    // mounted terminal there, so a direct (normally empty) registry lookup is
    // the faithful fallback.
    refreshTerminalLayout(paneId);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => refreshTerminalLayout(paneId)));
}

// Programmatic commands (task board, startup commands) bypass xterm's onData
// callback. Route a copy through the pane's automatic-title tracker before the
// bytes go to the PTY so they behave like commands typed by the user.
const inputTrackingRegistry = new Map<string, (data: string) => void>();
export function registerTerminalInputTracking(paneId: string, track: (data: string) => void): void {
  inputTrackingRegistry.set(paneId, track);
}
export function unregisterTerminalInputTracking(paneId: string): void {
  inputTrackingRegistry.delete(paneId);
}
export function trackTerminalInput(paneId: string, data: string): void {
  inputTrackingRegistry.get(paneId)?.(data);
}
