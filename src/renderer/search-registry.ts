import type { SearchAddon } from '@xterm/addon-search';

// Maps paneId -> its SearchAddon so the SearchBar (rendered in Pane) can drive
// search on the Terminal owned by TerminalView, without prop-drilling the term.
const registry = new Map<string, SearchAddon>();

export function registerSearch(paneId: string, addon: SearchAddon): void {
  registry.set(paneId, addon);
}

export function unregisterSearch(paneId: string): void {
  registry.delete(paneId);
}

export function findNext(paneId: string, query: string): void {
  registry.get(paneId)?.findNext(query);
}

export function findPrevious(paneId: string, query: string): void {
  registry.get(paneId)?.findPrevious(query);
}

export function clearSearch(paneId: string): void {
  registry.get(paneId)?.clearDecorations();
}
