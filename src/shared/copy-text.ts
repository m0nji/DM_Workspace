// Cleans up terminal selections for the clipboard. A terminal is a character
// grid: TUIs (Claude Code, Codex, …) paint their boxes by writing real spaces
// (often with a background colour), and they display long commands across
// several hard-wrapped lines. A raw selection therefore carries layout — line-
// padding spaces and newlines — that breaks pasting the text as a command.

/**
 * Strip spaces/tabs at the end of every line, keeping everything else —
 * notably leading indentation (meaningful in code) and blank lines. Safe as
 * the default for every copy: trailing padding is layout, never content.
 */
export function stripTrailingWhitespace(text: string): string {
  return text.split(/\r?\n/).map((line) => line.replace(/[ \t]+$/u, '')).join('\n');
}

/**
 * Collapse a selection into one pasteable command line: trim each line, drop
 * blank ones, join the fragments with single spaces. For commands a TUI
 * displayed across several padded lines. (If the TUI broke a long token mid-
 * word the join inserts a space there — not detectable from the grid alone.)
 */
export function selectionAsCommand(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(' ');
}
