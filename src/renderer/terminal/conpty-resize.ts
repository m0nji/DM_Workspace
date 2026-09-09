import type { Terminal } from '@xterm/xterm';

interface Line { isWrapped: boolean; getTrimmedLength(): number }
interface Marker { line: number; isDisposed: boolean; dispose(): void }
interface Buffer {
  ybase: number; ydisp: number; y: number; savedY: number;
  lines: {
    length: number; maxLength: number;
    get(i: number): Line | undefined;
    push(line: Line): void;
    pop(): Line | undefined;
    onDeleteEmitter: { fire(event: { index: number; amount: number }): void };
  };
  addMarker(line: number): Marker;
  getBlankLine(): Line;
}

// xterm 6.0.0's public resize API cannot keep the ConPTY viewport anchored.
// Keep the private surface here; native E2E tests exercise the installed xterm
// implementation, including full scrollback and cursor positioning.
type ConptyTerminal = Terminal & { _core: { _bufferService: { buffer: Buffer } } };

/** Reflow history while keeping the visible buffer in ConPTY coordinates. */
export function resizeConptyTerminal(term: Terminal, cols: number, rows: number): void {
  if (cols === term.cols || term.buffer.active.type !== 'normal') {
    term.resize(cols, rows);
    return;
  }
  const b = (term as ConptyTerminal)._core._bufferService.buffer;
  const top = b.addMarker(b.ybase);
  // ConPTY only knows the viewport, not xterm's scrollback. A wrapped first
  // viewport row must not be joined to a history row which ConPTY cannot see.
  const first = b.lines.get(b.ybase);
  if (first) first.isWrapped = false;
  try {
    term.resize(cols, rows);
    const cursor = b.ybase + b.y;
    let lastContent = cursor;
    for (let i = b.lines.length - 1; i > cursor; i--) {
      if (b.lines.get(i)?.getTrimmedLength()) { lastContent = i; break; }
    }
    // Widening leaves blank rows below instead of pulling history down.
    // Narrowing consumes blank rows first, then scrolls only as far as needed
    // to keep the cursor and existing nonblank viewport content on screen.
    const target = Math.max(top.isDisposed ? 0 : top.line, lastContent - rows + 1, 0);
    const delta = target - b.ybase;
    const followedBottom = b.ydisp === b.ybase;
    let trimmed = 0;
    if (delta > 0) {
      for (let i = 0; i < delta; i++) {
        if (b.lines.length === b.lines.maxLength) trimmed++;
        b.lines.push(b.getBlankLine());
      }
    } else if (delta < 0) {
      // target was computed from the last nonblank row: remove only spare
      // trailing blanks, never transcript rows (including deliberate repeats).
      const amount = -delta;
      for (let i = 0; i < amount; i++) b.lines.pop();
      b.lines.onDeleteEmitter.fire({ index: b.lines.length, amount });
    }
    b.ybase = target - trimmed;
    b.y = cursor - target;
    b.savedY = Math.max(0, b.savedY - trimmed);
    b.ydisp = followedBottom ? b.ybase : Math.max(0, Math.min(b.ybase, b.ydisp - trimmed));
    term.refresh(0, rows - 1);
  } finally {
    top.dispose();
  }
}
