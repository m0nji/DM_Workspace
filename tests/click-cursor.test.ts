import { describe, it, expect } from 'vitest';
import { clickMoveSequence, type RowMeta } from '../src/shared/click-cursor';

const ESC = '\x1b';
const LEFT = `${ESC}[D`;
const RIGHT = `${ESC}[C`;

// Helper: build row metadata from plain content strings (no wrapped rows).
const hardLines = (...texts: string[]): RowMeta[] =>
  texts.map((t) => ({ length: t.length, wrapped: false }));

describe('clickMoveSequence', () => {
  it('returns an empty string when the click lands on the cursor cell', () => {
    expect(clickMoveSequence(hardLines('echo hi'), { x: 5, y: 0 }, { x: 5, y: 0 })).toBe('');
  });

  it('moves right with CSI C along the same line', () => {
    expect(clickMoveSequence(hardLines('echo hi'), { x: 2, y: 0 }, { x: 5, y: 0 })).toBe(RIGHT.repeat(3));
  });

  it('moves left with CSI D along the same line', () => {
    expect(clickMoveSequence(hardLines('echo hi'), { x: 5, y: 0 }, { x: 2, y: 0 })).toBe(LEFT.repeat(3));
  });

  it('crosses a hard newline upward using only left arrows (counting through the line end)', () => {
    // row0 "echo aaaa" (len 9), row1 "bbb" (len 3). From (row1,col3) to (row0,col4):
    // 3 lefts to row1 col0, 1 left across the newline to row0 end (col9), then 5 lefts to col4 = 9.
    const rows = hardLines('echo aaaa', 'bbb');
    expect(clickMoveSequence(rows, { x: 3, y: 1 }, { x: 4, y: 0 })).toBe(LEFT.repeat(9));
  });

  it('crosses a hard newline downward using only right arrows', () => {
    const rows = hardLines('echo aaaa', 'bbb');
    expect(clickMoveSequence(rows, { x: 4, y: 0 }, { x: 3, y: 1 })).toBe(RIGHT.repeat(9));
  });

  it('treats a wrapped continuation row as one continuous line (no extra newline step)', () => {
    // row0 fills the width (len 10), row1 is its wrapped continuation (len 3).
    const rows: RowMeta[] = [
      { length: 10, wrapped: false },
      { length: 3, wrapped: true }
    ];
    // (row0,col8) -> (row1,col1): col8->col9 (1), col9->row1 col0 (2), ->col1 (3). No newline gap.
    expect(clickMoveSequence(rows, { x: 8, y: 0 }, { x: 1, y: 1 })).toBe(RIGHT.repeat(3));
  });

  it('uses the SS3 (ESC O) prefix when application cursor keys mode is active', () => {
    expect(clickMoveSequence(hardLines('echo hi'), { x: 0, y: 0 }, { x: 2, y: 0 }, true)).toBe(
      `${ESC}OC`.repeat(2)
    );
  });
});
