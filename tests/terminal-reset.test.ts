import { describe, expect, it } from 'vitest';
import { STUCK_MODE_RESET, sanitizeRestoredScrollback } from '../src/shared/terminal-reset';

// DECRST/DECSET private modes that must be covered so the "Reset terminal"
// context-menu action recovers a pane whose TUI exited uncleanly.
const DECRST = (mode: number) => `\x1b[?${mode}l`;
const DECSET = (mode: number) => `\x1b[?${mode}h`;

describe('STUCK_MODE_RESET', () => {
  it('disables all mouse tracking modes and the SGR encoding', () => {
    for (const mode of [9, 1000, 1001, 1002, 1003, 1006]) {
      expect(STUCK_MODE_RESET).toContain(DECRST(mode));
    }
  });

  it('leaves the alternate screen buffer (all three historic variants)', () => {
    // A TUI that crashes inside the alternate screen leaves the pane stuck
    // there: the wheel then pages through shell history (arrow-key emulation)
    // instead of scrolling. 1049 is the modern mode, 1047 and 47 the legacy ones.
    for (const mode of [1049, 1047, 47]) {
      expect(STUCK_MODE_RESET).toContain(DECRST(mode));
    }
  });

  it('makes the cursor visible again', () => {
    expect(STUCK_MODE_RESET).toContain(DECSET(25));
  });

  it('contains only escape sequences, no printable characters', () => {
    // The reset must be content-preserving: nothing may be printed into the pane.
    expect(STUCK_MODE_RESET.replace(/\x1b\[\?\d+[lh]/g, '')).toBe('');
  });
});

// Saves written by app versions ≤ 0.9.30 embed the live terminal modes and any
// active alternate-screen frame (SerializeAddon appends them unless excluded).
// Replaying such a save poisons the fresh pane: it starts inside the alt screen
// (no scrollback) with mouse tracking on (wheel hijacked). The sanitizer heals
// those files on restore; new saves exclude modes and the alt buffer entirely.
describe('sanitizeRestoredScrollback', () => {
  it('strips a trailing modes block (mouse tracking, bracketed paste, focus reporting)', () => {
    const content = 'line one\r\nline two';
    const poisoned = `${content}\x1b[?2004h\x1b[?1004h\x1b[?1003h`;
    expect(sanitizeRestoredScrollback(poisoned)).toBe(content);
  });

  it('cuts everything from the alternate-screen switch onward', () => {
    // serialize() appends `?1049h` + cursor-home + the alt-buffer frame when the
    // pane sat in the alt screen at save time. The frame is a dead TUI painting;
    // replaying the switch would trap the restored pane in the alt screen.
    const content = 'history kept';
    const poisoned = `${content}\x1b[?1049h\x1b[Hdead TUI frame\x1b[?1003h`;
    expect(sanitizeRestoredScrollback(poisoned)).toBe(content);
  });

  it('handles the legacy alternate-screen variants (?1047, ?47)', () => {
    for (const mode of [1047, 47]) {
      const poisoned = `keep\x1b[?${mode}hgone`;
      expect(sanitizeRestoredScrollback(poisoned)).toBe('keep');
    }
  });

  it('strips ANSI set/reset modes such as insert mode (4h)', () => {
    expect(sanitizeRestoredScrollback('text\x1b[4h')).toBe('text');
  });

  it('strips a replayed hidden-cursor state (?25l)', () => {
    expect(sanitizeRestoredScrollback('text\x1b[?25l')).toBe('text');
  });

  it('keeps text, colors, cursor movement and erase sequences untouched', () => {
    // Everything serialize() emits for buffer *content* must survive: SGR
    // colors, relative cursor moves, erase-in-line, and plain rows.
    const clean = '\x1b[31mred\x1b[0m text\r\n\x1b[5C\x1b[2Xmore\r\nlast\x1b[2B\x1b[3A';
    expect(sanitizeRestoredScrollback(clean)).toBe(clean);
  });

  it('is a no-op on saves written by the fixed format', () => {
    const clean = 'plain history\r\nsecond line';
    expect(sanitizeRestoredScrollback(clean)).toBe(clean);
  });
});
