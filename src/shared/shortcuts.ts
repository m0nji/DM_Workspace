// Shared keyboard-shortcut model: action ids, platform-aware defaults, label
// metadata, normalization, conflict/terminal-safety checks, and event matching.
//
// Bindings are stored as normalized strings using `Mod` as the platform-agnostic
// primary modifier (⌘ on macOS, Ctrl elsewhere). Modifier order is canonical
// (`Mod+Alt+Shift+Key`) so two bindings compare with a plain string equals.

export const SHORTCUT_ACTIONS = [
  'commandPalette',
  'newWorkspace',
  'closePane',
  'searchPane',
  'splitHorizontal',
  'splitVertical',
  'toggleMaximize',
  'openSettings',
  'togglePreview'
] as const;

export type ShortcutAction = typeof SHORTCUT_ACTIONS[number];
export type ShortcutMap = Record<ShortcutAction, string>;

export interface ShortcutDefinition {
  action: ShortcutAction;
  label: string;
  // Defaults diverge by platform: on Windows/Linux every letter shortcut keeps a
  // Shift so terminal control codes (Ctrl+C/D/W …) still reach the shell; macOS
  // uses the bare ⌘ combos because the shell listens on Ctrl, not ⌘.
  macDefault: string;
  otherDefault: string;
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { action: 'commandPalette', label: 'Command palette', macDefault: 'Mod+Shift+P', otherDefault: 'Mod+Shift+P' },
  { action: 'newWorkspace', label: 'New workspace', macDefault: 'Mod+T', otherDefault: 'Mod+Shift+T' },
  { action: 'closePane', label: 'Close focused pane', macDefault: 'Mod+W', otherDefault: 'Mod+Shift+W' },
  { action: 'searchPane', label: 'Search focused pane', macDefault: 'Mod+F', otherDefault: 'Mod+Shift+F' },
  { action: 'splitHorizontal', label: 'Split left and right', macDefault: 'Mod+D', otherDefault: 'Mod+Shift+D' },
  { action: 'splitVertical', label: 'Split top and bottom', macDefault: 'Mod+Shift+D', otherDefault: 'Mod+Alt+Shift+D' },
  { action: 'toggleMaximize', label: 'Maximize focused pane', macDefault: 'Mod+Enter', otherDefault: 'Mod+Enter' },
  { action: 'openSettings', label: 'Open settings', macDefault: 'Mod+Comma', otherDefault: 'Mod+Comma' },
  { action: 'togglePreview', label: 'Toggle preview panel', macDefault: 'Mod+Shift+M', otherDefault: 'Mod+Shift+M' }
];

const MODIFIERS = ['Mod', 'Alt', 'Shift'] as const;

function normalizeToken(part: string): string {
  const lower = part.toLowerCase();
  if (lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'command' || lower === 'mod') return 'Mod';
  if (lower === 'option' || lower === 'alt') return 'Alt';
  if (lower === 'shift') return 'Shift';
  if (lower === ',' || lower === 'comma') return 'Comma';
  if (lower === 'esc' || lower === 'escape') return 'Escape';
  if (lower === ' ' || lower === 'space' || lower === 'spacebar') return 'Space';
  if (lower.length === 1) return lower.toUpperCase();
  return lower[0].toUpperCase() + lower.slice(1);
}

// Canonicalize a binding: map aliases, then emit modifiers in a fixed order
// followed by the (single) non-modifier key, so equality is a plain ===.
export function normalizeShortcut(raw: string): string {
  const tokens = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .map(normalizeToken);
  const mods = MODIFIERS.filter((m) => tokens.includes(m)) as string[];
  const keys = tokens.filter((t) => !MODIFIERS.includes(t as typeof MODIFIERS[number]));
  return [...mods, ...keys].join('+');
}

export function getDefaultShortcuts(isMac: boolean): ShortcutMap {
  return SHORTCUT_DEFINITIONS.reduce((acc, def) => {
    acc[def.action] = isMac ? def.macDefault : def.otherDefault;
    return acc;
  }, {} as ShortcutMap);
}

// Merge persisted overrides onto the platform defaults. Unknown keys are dropped.
export function resolveShortcuts(overrides: Partial<ShortcutMap> | undefined, isMac: boolean): ShortcutMap {
  const map = getDefaultShortcuts(isMac);
  if (overrides) {
    for (const action of SHORTCUT_ACTIONS) {
      const value = overrides[action];
      if (typeof value === 'string' && value.length > 0) map[action] = value;
    }
  }
  return map;
}

export function isShortcutConflict(binding: string, action: ShortcutAction, map: ShortcutMap): boolean {
  const normalized = normalizeShortcut(binding);
  return Object.entries(map).some(
    ([otherAction, otherBinding]) => otherAction !== action && normalizeShortcut(otherBinding) === normalized
  );
}

// On Windows/Linux a bare `Ctrl+<letter>` is a shell control code (Ctrl+C/D/W/R/…),
// so the editor refuses it. Adding any other modifier (Shift/Alt) makes it safe.
// macOS routes shell control through Ctrl while app shortcuts use ⌘, so nothing
// is reserved there.
export function isReservedTerminalShortcut(binding: string, isMac: boolean): boolean {
  if (isMac) return false;
  const parts = normalizeShortcut(binding).split('+');
  return parts.length === 2 && parts[0] === 'Mod' && /^[A-Z]$/.test(parts[1]);
}

export interface ShortcutLikeEvent {
  key: string;
  code?: string; // physical key (e.g. 'KeyD'); preferred over `key` so Option-composed chars don't corrupt bindings on macOS
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

// Map a physical KeyboardEvent.code to a stable key token, so a layout- or
// Option-mangled `key` (e.g. Option+D → '∂', or a dead key → 'Dead') doesn't
// poison the binding. Returns null for codes we don't special-case (fall back to key).
function keyTokenFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);       // KeyD -> D
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);     // Digit1 -> 1
  const map: Record<string, string> = {
    Comma: 'Comma', Period: 'Period', Slash: 'Slash', Backslash: 'Backslash',
    Enter: 'Enter', NumpadEnter: 'Enter', Space: 'Space', Escape: 'Escape',
    Minus: 'Minus', Equal: 'Equal'
  };
  return map[code] ?? null;
}

// Derive a normalized binding from a keyboard event. Returns null when:
//  - only a bare modifier key is held (recording waits for the real key), or
//  - the opposite primary modifier is held (Ctrl on mac / Win on others) — those
//    aren't app shortcuts and should fall through to the shell.
export function shortcutFromEvent(e: ShortcutLikeEvent, isMac: boolean): string | null {
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(e.key)) return null;
  if (isMac ? e.ctrlKey : e.metaKey) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push('Mod');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push((e.code && keyTokenFromCode(e.code)) || e.key);
  return normalizeShortcut(parts.join('+'));
}

export function shortcutMatches(e: ShortcutLikeEvent, binding: string, isMac: boolean): boolean {
  const actual = shortcutFromEvent(e, isMac);
  return actual !== null && actual === normalizeShortcut(binding);
}

const MAC_SYMBOLS: Record<string, string> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↩', Comma: ',', Escape: '⎋', Space: '␣' };
const PC_LABELS: Record<string, string> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', Comma: ',', Escape: 'Esc', Space: 'Space' };

// Per-key display tokens of a normalized binding, e.g. ['⌘','⇧','P'] on macOS or
// ['Ctrl','Shift','P'] elsewhere. Multi-character keys (F5, Tab, ArrowLeft) stay
// intact as a single cap — callers rendering individual key "caps" must use this
// rather than splitting the joined formatShortcut() string.
export function formatShortcutCaps(binding: string, isMac: boolean): string[] {
  const table = isMac ? MAC_SYMBOLS : PC_LABELS;
  return normalizeShortcut(binding).split('+').map((t) => table[t] ?? t);
}

// Human-facing rendering of a normalized binding. macOS uses Apple's glyphs with
// no separators (⌘⇧P); other platforms spell modifiers out joined by '+'.
export function formatShortcut(binding: string, isMac: boolean): string {
  return formatShortcutCaps(binding, isMac).join(isMac ? '' : '+');
}
