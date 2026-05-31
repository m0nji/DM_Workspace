import { describe, expect, it } from 'vitest';
import {
  getDefaultShortcuts,
  resolveShortcuts,
  normalizeShortcut,
  isShortcutConflict,
  isReservedTerminalShortcut,
  shortcutFromEvent,
  shortcutMatches,
  formatShortcut,
  formatShortcutCaps
} from '../src/shared/shortcuts';

describe('normalizeShortcut', () => {
  it('normalizes common aliases', () => {
    expect(normalizeShortcut('ctrl+shift+p')).toBe('Mod+Shift+P');
    expect(normalizeShortcut('cmd+,')).toBe('Mod+Comma');
    expect(normalizeShortcut('option+enter')).toBe('Alt+Enter');
  });

  it('canonicalizes modifier order regardless of input order', () => {
    expect(normalizeShortcut('Shift+Alt+Mod+D')).toBe('Mod+Alt+Shift+D');
    expect(normalizeShortcut('shift+mod+p')).toBe('Mod+Shift+P');
  });

  it('is idempotent on already-normalized bindings', () => {
    expect(normalizeShortcut('Mod+Alt+Shift+D')).toBe('Mod+Alt+Shift+D');
  });
});

describe('default shortcuts', () => {
  it('ships a command palette default on both platforms', () => {
    expect(getDefaultShortcuts(true).commandPalette).toBe('Mod+Shift+P');
    expect(getDefaultShortcuts(false).commandPalette).toBe('Mod+Shift+P');
  });

  it('preserves the existing platform-divergent letter shortcuts', () => {
    // macOS used ⌘+W / ⌘+T / ⌘+F / ⌘+D without Shift.
    expect(getDefaultShortcuts(true).closePane).toBe('Mod+W');
    expect(getDefaultShortcuts(true).newWorkspace).toBe('Mod+T');
    expect(getDefaultShortcuts(true).splitVertical).toBe('Mod+Shift+D');
    // Windows/Linux require Shift so Ctrl+C/D/W keep reaching the shell.
    expect(getDefaultShortcuts(false).closePane).toBe('Mod+Shift+W');
    expect(getDefaultShortcuts(false).newWorkspace).toBe('Mod+Shift+T');
    expect(getDefaultShortcuts(false).splitVertical).toBe('Mod+Alt+Shift+D');
  });

  it('resolves overrides on top of platform defaults', () => {
    const map = resolveShortcuts({ commandPalette: 'Mod+Alt+P' }, true);
    expect(map.commandPalette).toBe('Mod+Alt+P');
    expect(map.closePane).toBe('Mod+W');
  });

  it('ignores unknown override keys', () => {
    const map = resolveShortcuts({ bogus: 'Mod+X' } as never, true);
    expect((map as Record<string, string>).bogus).toBeUndefined();
  });
});

describe('isShortcutConflict', () => {
  it('detects conflicts with another action', () => {
    const map = { ...getDefaultShortcuts(true), openSettings: 'Mod+Shift+P' };
    expect(isShortcutConflict('Mod+Shift+P', 'commandPalette', map)).toBe(true);
  });

  it('does not flag a binding against its own action', () => {
    const map = getDefaultShortcuts(true); // openSettings is the only Mod+Comma
    expect(isShortcutConflict(map.openSettings, 'openSettings', map)).toBe(false);
  });
});

describe('isReservedTerminalShortcut', () => {
  it('rejects plain Ctrl+letter shortcuts on Windows/Linux', () => {
    expect(isReservedTerminalShortcut('Mod+C', false)).toBe(true);
    expect(isReservedTerminalShortcut('Mod+D', false)).toBe(true);
    expect(isReservedTerminalShortcut('Mod+W', false)).toBe(true);
    expect(isReservedTerminalShortcut('Mod+R', false)).toBe(true);
  });

  it('allows letter shortcuts once another modifier is added', () => {
    expect(isReservedTerminalShortcut('Mod+Shift+W', false)).toBe(false);
    expect(isReservedTerminalShortcut('Mod+Alt+D', false)).toBe(false);
  });

  it('does not reserve anything on macOS (shell uses Ctrl, not Cmd)', () => {
    expect(isReservedTerminalShortcut('Mod+C', true)).toBe(false);
  });

  it('does not reserve non-letter combos', () => {
    expect(isReservedTerminalShortcut('Mod+Enter', false)).toBe(false);
    expect(isReservedTerminalShortcut('Mod+Comma', false)).toBe(false);
  });
});

describe('shortcutFromEvent', () => {
  it('builds a canonical binding from a keyboard event', () => {
    expect(shortcutFromEvent(
      { key: 'p', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true },
      false
    )).toBe('Mod+Shift+P');
  });

  it('rejects events holding the opposite primary modifier', () => {
    // bare Ctrl on mac → shell control, not an app shortcut
    expect(shortcutFromEvent(
      { key: 'c', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
      true
    )).toBeNull();
    // Ctrl+Cmd+T on mac must NOT collapse to the newWorkspace binding
    expect(shortcutFromEvent(
      { key: 't', ctrlKey: true, metaKey: true, altKey: false, shiftKey: false },
      true
    )).toBeNull();
    // Win+Ctrl+Shift+T on win/linux must not match either
    expect(shortcutFromEvent(
      { key: 't', ctrlKey: true, metaKey: true, altKey: false, shiftKey: true },
      false
    )).toBeNull();
  });

  it('returns null while only a modifier key is held', () => {
    expect(shortcutFromEvent(
      { key: 'Control', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
      false
    )).toBeNull();
  });

  it('prefers the physical code so Option-composed keys do not corrupt the binding', () => {
    // macOS Option+D yields key='∂' but code='KeyD' → must record as Mod+Alt+D
    expect(shortcutFromEvent(
      { key: '∂', code: 'KeyD', ctrlKey: false, metaKey: true, altKey: true, shiftKey: false },
      true
    )).toBe('Mod+Alt+D');
    // a dead key (Option+E) reports key='Dead' but code='KeyE'
    expect(shortcutFromEvent(
      { key: 'Dead', code: 'KeyE', ctrlKey: false, metaKey: true, altKey: true, shiftKey: false },
      true
    )).toBe('Mod+Alt+E');
  });
});

describe('formatShortcut', () => {
  it('renders mac symbols without separators', () => {
    expect(formatShortcut('Mod+Shift+P', true)).toBe('⌘⇧P');
    expect(formatShortcut('Mod+Comma', true)).toBe('⌘,');
    expect(formatShortcut('Mod+Alt+Shift+D', true)).toBe('⌘⌥⇧D');
    expect(formatShortcut('Mod+Enter', true)).toBe('⌘↩');
  });

  it('renders spelled-out modifiers joined by + elsewhere', () => {
    expect(formatShortcut('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
    expect(formatShortcut('Mod+Comma', false)).toBe('Ctrl+,');
  });
});

describe('formatShortcutCaps', () => {
  it('returns per-key caps with macOS glyphs', () => {
    expect(formatShortcutCaps('Mod+Shift+P', true)).toEqual(['⌘', '⇧', 'P']);
  });
  it('keeps a multi-character key as a single cap (no shattering)', () => {
    expect(formatShortcutCaps('Mod+F5', true)).toEqual(['⌘', 'F5']);
  });
  it('spells out modifiers on non-mac', () => {
    expect(formatShortcutCaps('Mod+Shift+P', false)).toEqual(['Ctrl', 'Shift', 'P']);
  });
  it('formatShortcut joins the same caps', () => {
    expect(formatShortcut('Mod+Shift+P', true)).toBe('⌘⇧P');
    expect(formatShortcut('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
  });
});

describe('shortcutMatches', () => {
  it('matches keyboard-like event objects against bindings', () => {
    expect(shortcutMatches(
      { key: 'p', ctrlKey: true, metaKey: false, altKey: false, shiftKey: true },
      'Mod+Shift+P',
      false
    )).toBe(true);
  });

  it('does not match when a required modifier is missing', () => {
    expect(shortcutMatches(
      { key: 'p', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false },
      'Mod+Shift+P',
      false
    )).toBe(false);
  });
});
