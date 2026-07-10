import { describe, expect, it } from 'vitest';
import { STUCK_MODE_RESET } from '../src/shared/terminal-reset';

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
