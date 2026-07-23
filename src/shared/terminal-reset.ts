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
