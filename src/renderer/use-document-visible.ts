import { useSyncExternalStore } from 'react';

// Window focus is not visibility: side-by-side windows must keep rendering.
// Electron updates document.hidden for hide/minimize (and macOS occlusion).
// Keep terminals mounted while hidden; only release graphics resources and
// reduce work that TerminalView already gates on its active flag.
const subscribe = (changed: () => void): (() => void) => {
  document.addEventListener('visibilitychange', changed);
  return () => document.removeEventListener('visibilitychange', changed);
};
const visible = (): boolean => !document.hidden;

export function useDocumentVisible(): boolean {
  return useSyncExternalStore(subscribe, visible);
}
