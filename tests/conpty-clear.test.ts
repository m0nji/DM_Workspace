import { describe, it, expect } from 'vitest';
import { conptyClearSequence, cursorLineRows } from '../src/shared/conpty-clear';

describe('conptyClearSequence', () => {
  it('erases above and below the kept row, then the scrollback', () => {
    // Prompt on row 16 of 30 (0-based), 120 columns.
    expect(conptyClearSequence(16, 16, 30, 120)).toBe(
      '\x1b7' + '\x1b[16;120H\x1b[1J' + '\x1b[18;1H\x1b[0J' + '\x1b8' + '\x1b[3J'
    );
  });

  it('skips the erase above when the prompt is already on the first row', () => {
    expect(conptyClearSequence(0, 0, 30, 80)).toBe('\x1b7\x1b[2;1H\x1b[0J\x1b8\x1b[3J');
  });

  it('skips the erase below when the prompt is on the last row', () => {
    expect(conptyClearSequence(29, 29, 30, 80)).toBe('\x1b7\x1b[29;80H\x1b[1J\x1b8\x1b[3J');
  });

  it('keeps a multi-row block intact', () => {
    expect(conptyClearSequence(10, 12, 30, 80)).toBe('\x1b7\x1b[10;80H\x1b[1J\x1b[14;1H\x1b[0J\x1b8\x1b[3J');
  });
});

describe('cursorLineRows', () => {
  it('is just the cursor row for an unwrapped line', () => {
    expect(cursorLineRows(5, 24, () => false)).toEqual([5, 5]);
  });

  it('spans every soft-wrapped row of the cursor line', () => {
    // Rows 4..7 form one logical line (5, 6, 7 continue the row above).
    const wrapped = new Set([5, 6, 7]);
    expect(cursorLineRows(6, 24, (r) => wrapped.has(r))).toEqual([4, 7]);
  });

  it('stops at the viewport edges', () => {
    expect(cursorLineRows(0, 3, () => true)).toEqual([0, 2]);
  });
});
