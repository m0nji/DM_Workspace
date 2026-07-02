import { useEffect } from 'react';
import { useStore } from './store';
import { resolveShortcuts, shortcutMatches, type ShortcutAction } from '../shared/shortcuts';

const isMac = navigator.userAgent.includes('Mac');

// App-level keyboard shortcuts. Bindings are resolved from user overrides on top
// of platform-aware defaults (see shared/shortcuts.ts), so the editor in Settings
// can rebind any action. Workspace switching (Mod+1..9) stays fixed.
//
// Every shortcut requires the primary modifier (⌘ on mac, Ctrl elsewhere); the
// early `!mod` return lets plain keystrokes reach the focused terminal untouched —
// and on mac it means bare Ctrl+C/D/W still go to the shell.
export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const s = useStore.getState();
      // The shortcut editor is capturing a key — let it through untouched.
      if (s.shortcutRecordingAction) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      // An open modal (shared .modal-backdrop pattern: confirms, workspace
      // editor, changelog, settings) owns the keyboard — app shortcuts must not
      // act on the layout behind it (e.g. Mod+W closing a pane behind a delete
      // confirmation).
      if (document.querySelector('.modal-backdrop')) return;

      // Capture phase on window runs before xterm's textarea handler; we must
      // BOTH preventDefault and stopPropagation on a match so the keystroke never
      // reaches the terminal (preventDefault alone still lets it propagate down,
      // and xterm would emit a control byte on Ctrl+letter combos).
      const stop = (): void => { e.preventDefault(); e.stopPropagation(); };

      // Fixed: jump to workspace 1..9.
      if (!e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const ws = s.workspaces[Number(e.key) - 1];
        if (ws) { stop(); s.selectWorkspace(ws.id); }
        return;
      }

      const bindings = resolveShortcuts(s.settings.shortcutBindings, isMac);
      const is = (action: ShortcutAction): boolean => shortcutMatches(e, bindings[action], isMac);

      if (is('commandPalette')) { stop(); s.setCommandPaletteOpen(!s.commandPaletteOpen); return; }
      if (is('newWorkspace')) { stop(); s.addWorkspace(); return; }
      if (is('openSettings')) { stop(); s.setSettingsOpen(true); return; }
      if (is('togglePreview')) { stop(); s.togglePreview(); return; }
      if (is('toggleMaximize')) { if (s.focusedPaneId) { stop(); s.toggleMaximize(s.focusedPaneId); } return; }
      if (is('closePane')) { if (s.focusedPaneId) { stop(); s.closeActivePane(s.focusedPaneId); } return; }
      if (is('searchPane')) { if (s.focusedPaneId) { stop(); s.setSearchOpen(s.focusedPaneId); } return; }
      // Exact matching disambiguates the two split bindings (vertical carries an extra modifier).
      if (is('splitVertical')) { if (s.focusedPaneId) { stop(); s.splitActivePane(s.focusedPaneId, 'v'); } return; }
      if (is('splitHorizontal')) { if (s.focusedPaneId) { stop(); s.splitActivePane(s.focusedPaneId, 'h'); } return; }
    };
    // Capture phase so we intercept before xterm's textarea handler.
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
