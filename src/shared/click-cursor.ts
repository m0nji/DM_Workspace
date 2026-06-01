// Translate a mouse click into the arrow-key sequence that walks the cursor
// from its current cell to the clicked cell, for click-to-position editing
// inside a program that owns its own input line (a shell, Claude Code, Codex).
//
// We move using ONLY ←/→. In these editors the left/right arrows cross line
// boundaries (← at the start of a line jumps to the end of the previous line),
// so the whole distance — even across a multi-line draft — can be covered
// horizontally. ↑/↓ are NOT used: in shells and Claude/Codex they are bound to
// history recall, not in-buffer line navigation, so an ↑ fetches the previous
// command instead of moving up a line.
//
// The number of presses between two cells is the count of editable positions
// between them. Each hard-newline row contributes its content length plus one
// step for the newline crossing; a wrapped continuation row (xterm isWrapped)
// adds no newline step because it is the same logical line continuing.
//
// Limitation: cells occupied by a prompt/continuation-prompt/box-border are not
// editable, but the terminal can't know where they are, so counts can be off on
// inputs that prefix every line. Single-line and wrapped inputs are exact.

export interface Cell {
  x: number; // column, 0-based
  y: number; // row, viewport-relative, 0-based
}

export interface RowMeta {
  length: number; // trimmed content length of the row
  wrapped: boolean; // xterm isWrapped: this row is a continuation of the previous
}

// Forward (reading-order) step count from (fr,fc) to (tr,tc), where the target
// is at or after the source. Counts cursor stops, adding a newline crossing
// only where the next row is not a wrapped continuation.
function forwardSteps(rows: RowMeta[], fr: number, fc: number, tr: number, tc: number): number {
  if (fr === tr) return tc - fc;
  let steps = (rows[fr].length - fc) + (rows[fr + 1]?.wrapped ? 0 : 1);
  for (let k = fr + 1; k < tr; k++) {
    steps += rows[k].length + (rows[k + 1]?.wrapped ? 0 : 1);
  }
  return steps + tc;
}

export function clickMoveSequence(rows: RowMeta[], cursor: Cell, target: Cell, appCursorKeys = false): string {
  const prefix = appCursorKeys ? '\x1bO' : '\x1b[';
  const targetIsBefore = target.y < cursor.y || (target.y === cursor.y && target.x < cursor.x);
  const steps = targetIsBefore
    ? forwardSteps(rows, target.y, target.x, cursor.y, cursor.x)
    : forwardSteps(rows, cursor.y, cursor.x, target.y, target.x);
  const arrow = `${prefix}${targetIsBefore ? 'D' : 'C'}`; // D = left, C = right
  return arrow.repeat(Math.max(0, steps));
}
