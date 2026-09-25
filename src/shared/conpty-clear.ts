// "Clear Window" for a local Windows pane.
//
// xterm's own clear() moves the prompt line to the top of the viewport. That
// is fine for a POSIX pty, which never looks at the screen again. ConPTY does:
// it keeps its own copy of the console buffer, where the prompt is still on its
// old row, and paints every later change with absolute cursor positions. The
// next keystroke therefore lands on the pre-clear row, far below the prompt.
//
// node-pty's clear() (ClearPseudoConsole) would resync ConPTY, but it is only
// wired up for the bundled conpty.dll, not the inbox ConPTY we use. At a
// PowerShell prompt the shell clears its own buffer instead (F23, see
// PSREADLINE_CLEAR_CHORD). Everywhere else — another shell, a running program —
// this is the fallback: the terminal meets ConPTY where it is, the rows holding
// the prompt stay on their row and everything else — the viewport above and
// below plus the scrollback — is erased. A later resize can bring the old
// content back there, because ConPTY repaints from its uncleared copy.

/**
 * Escape sequence that blanks the viewport except rows `keepTop..keepBottom`
 * (0-based, inclusive) and drops the scrollback, leaving the cursor untouched.
 */
export function conptyClearSequence(keepTop: number, keepBottom: number, rows: number, cols: number): string {
  let seq = '\x1b7'; // DECSC: save cursor
  // ED 1 erases from the top of the screen through the cursor, so park the
  // cursor on the last column of the row just above the kept block.
  if (keepTop > 0) seq += `\x1b[${keepTop};${cols}H\x1b[1J`;
  // ED 0 from the first column of the row just below the kept block.
  if (keepBottom < rows - 1) seq += `\x1b[${keepBottom + 2};1H\x1b[0J`;
  seq += '\x1b8'; // DECRC: restore cursor
  seq += '\x1b[3J'; // ED 3: erase the scrollback
  return seq;
}

/**
 * Rows (viewport-relative) of the logical line the cursor is on: a long command
 * line soft-wraps over several rows, and all of them belong to the prompt.
 * `isWrapped(row)` says whether viewport row `row` continues the row above.
 */
export function cursorLineRows(cursorY: number, rows: number, isWrapped: (row: number) => boolean): [number, number] {
  let top = cursorY;
  while (top > 0 && isWrapped(top)) top--;
  let bottom = cursorY;
  while (bottom < rows - 1 && isWrapped(bottom + 1)) bottom++;
  return [top, bottom];
}
