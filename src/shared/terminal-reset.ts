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
