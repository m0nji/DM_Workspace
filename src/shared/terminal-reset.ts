// A TUI (e.g. Claude Code, Codex) that exits uncleanly leaves xterm stuck in
// whatever private modes it had enabled. The two failure classes seen in the
// wild:
//
//  - Mouse tracking left on: hijacks the wheel and text selection so the pane
//    can no longer be scrolled or copied. Covers X10 (?9), VT200/normal
//    (?1000), highlight (?1001), button-event/drag (?1002) and any-event
//    (?1003) tracking plus the SGR extended encoding (?1006).
//  - Alternate screen left active: xterm emulates arrow keys for the wheel
//    there, so scrolling pages through shell history instead of the buffer.
//    ?1049 is the modern mode, ?1047 and ?47 the legacy variants; leaving a
//    buffer that is not active is a no-op, so all three are always safe.
//
// ?25h re-shows a cursor the TUI hid before crashing. Driven by the
// "Reset terminal" context-menu action — an explicit, content-preserving
// recovery (it does not clear the buffer; that is "Clear window").
export const STUCK_MODE_RESET =
  '\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1006l' +
  '\x1b[?1049l\x1b[?1047l\x1b[?47l' +
  '\x1b[?25h';

// The alt-screen switch serialize() emits when a pane sat in the alternate
// screen at save time; the dead TUI frame follows it.
const ALT_SCREEN_SWITCHES = ['\x1b[?1049h', '\x1b[?1047h', '\x1b[?47h'];

// Heal a saved scrollback string before replaying it into a fresh terminal.
//
// Saves written by app versions ≤ 0.9.30 called SerializeAddon.serialize()
// without excludeModes/excludeAltBuffer, so they embed the live terminal state
// at save time: an active alternate-screen frame plus DECSET modes like ?1003h
// (mouse tracking), ?2004h (bracketed paste) and ?1004h (focus reporting).
// Replaying that poisons the restored pane — it starts inside the alt screen,
// where there is no scrollback, with a hijacked wheel — the recurring
// "restored session can no longer scroll" bug. Current saves exclude modes and
// the alt buffer; this sanitizer repairs files the old format left behind.
export function sanitizeRestoredScrollback(data: string): string {
  // Cut at the alternate-screen switch: the alt-buffer frame after it is a dead
  // TUI painting, meaningless after a restart, and the switch itself would trap
  // the pane in the alt screen.
  let out = data;
  for (const seq of ALT_SCREEN_SWITCHES) {
    const i = out.indexOf(seq);
    if (i >= 0) out = out.slice(0, i);
  }
  // Strip every remaining SM/RM (set/reset mode, ANSI or private). Serialized
  // buffer *content* never contains them — rows are text plus SGR colors,
  // relative cursor moves and erase sequences — so anything matched here came
  // from the old format's appended modes block.
  return out.replace(/\x1b\[[0-9;?]*[hl]/g, '');
}

// Park a replayed history in the SCROLLBACK before the shell starts writing,
// leaving it an empty viewport with the cursor at the top.
//
// A restored pane replays its saved history before spawning the shell, so the
// history appears above the coming prompt rather than interleaved with it. Left
// in the viewport, though, that history is doomed: a shell addresses the
// viewport in absolute coordinates and assumes ITS session begins at row 0. It
// never learns about the rows we injected, so its coordinates are offset by
// exactly that many rows, and any full repaint paints straight over them.
// Both repaints were observed on Windows 11 / PowerShell 5.1:
//
//   start:  ESC[?25l ESC[2J ESC[m ESC[H PS C:\Users\…>     — erase all, home
//   resize: ESC[?25l ESC[8;52;74t ESC[H <prompt redrawn>    — home, then a
//           \r\n ESC[K cascade blanking every remaining row
//
// The first wiped a restored history ~200ms after it appeared, and the pane's
// next save then wrote the emptied buffer over the good one — history destroyed
// for good, on every restart. The second did the same on the next pane split.
//
// Filtering those sequences out of the shell's output is not a fix: the shell
// would still be drawing at coordinates that mean something else than it thinks,
// and `clear`, `cls` and every TUI need them to work. Removing the offset is the
// fix. `rows` newlines scroll everything written so far past the top of the
// viewport and into the scrollback, where no viewport operation can reach it;
// the trailing CUP-home then puts the cursor on row 0, so the shell's first
// prompt starts where the shell already believes it does.
//
// Cost: one blank row lands in the scrollback between the restore separator and
// the new screen. Cheaper than the alternative — writing no newlines leaves the
// gap in the VIEWPORT instead, which shows as a screenful of blank space above
// the prompt on any shell that does not clear at startup (bash, zsh).
export function parkRestoredHistory(rows: number): string {
  // Guard the row count rather than trusting it: String.repeat turns NaN into 0
  // silently, which would emit no newline at all and leave the history exactly
  // where it must not be.
  const lines = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 1;
  return '\n'.repeat(lines) + '\x1b[H';
}
