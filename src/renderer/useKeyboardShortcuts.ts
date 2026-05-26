import { useEffect } from 'react';
import { useStore } from './store';

const isMac = navigator.userAgent.includes('Mac');

// Keymap (cross-platform-safe: on Windows/Linux all letter shortcuts require
// Shift so terminal control codes like Ctrl+D/Ctrl+W stay intact):
//   New workspace   mac ⌘+T        win/linux Ctrl+Shift+T
//   Close pane      mac ⌘+W        win/linux Ctrl+Shift+W
//   Search          mac ⌘+F        win/linux Ctrl+Shift+F
//   Split h         mac ⌘+D        win/linux Ctrl+Shift+D
//   Split v         mac ⌘+Shift+D  win/linux Ctrl+Alt+Shift+D
//   Maximize        mac ⌘+Enter    win/linux Ctrl+Enter
//   Workspace 1..9  mac ⌘+1..9     win/linux Ctrl+1..9
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      const s = useStore.getState();
      const key = e.key.toLowerCase();
      // letter shortcuts require Shift on win/linux, no Shift on mac
      const letterMod = isMac ? !e.shiftKey : e.shiftKey;

      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const ws = s.workspaces[Number(e.key) - 1];
        if (ws) { e.preventDefault(); s.selectWorkspace(ws.id); }
        return;
      }
      if (key === 't' && letterMod) { e.preventDefault(); s.addWorkspace(); return; }
      if (key === 'w' && letterMod) {
        if (s.focusedPaneId) { e.preventDefault(); s.closeActivePane(s.focusedPaneId); }
        return;
      }
      if (key === 'f' && letterMod) {
        if (s.focusedPaneId) { e.preventDefault(); s.setSearchOpen(s.focusedPaneId); }
        return;
      }
      if (key === 'enter') {
        if (s.focusedPaneId) { e.preventDefault(); s.toggleMaximize(s.focusedPaneId); }
        return;
      }
      // split vertical first (more specific): mac ⌘+Shift+D / win Ctrl+Alt+Shift+D
      if (key === 'd' && (isMac ? e.shiftKey && !e.altKey : e.shiftKey && e.altKey)) {
        if (s.focusedPaneId) { e.preventDefault(); e.stopPropagation(); s.splitActivePane(s.focusedPaneId, 'v'); }
        return;
      }
      // split horizontal: mac ⌘+D / win Ctrl+Shift+D (no Alt)
      if (key === 'd' && !e.altKey && letterMod) {
        if (s.focusedPaneId) { e.preventDefault(); e.stopPropagation(); s.splitActivePane(s.focusedPaneId, 'h'); }
        return;
      }
    };
    // Capture phase so we intercept before xterm's textarea handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
