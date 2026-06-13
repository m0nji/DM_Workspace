// Build the text inserted into the terminal line when a file (or a pasted
// clipboard image saved to a temp file) is dropped/pasted. The running program
// (Claude Code, Codex, opencode, a shell, …) reads this as input, so we follow
// the de-facto terminal drag-and-drop convention per platform:
//   - POSIX (macOS/Linux): backslash-escape spaces and shell-special chars,
//     exactly like Terminal.app / iTerm / GNOME Terminal do on a file drag.
//   - Windows: wrap in double quotes when the path contains a space (backslashes
//     are path separators there and must NOT be escaped).
// Each path gets a trailing space so the next token is separated.

// Characters that are special to a POSIX shell and must be escaped with a backslash.
const POSIX_SPECIAL = /[\s\\'"`$&|;<>(){}[\]*?!#~]/g;

function escapePosix(p: string): string {
  return p.replace(POSIX_SPECIAL, (ch) => '\\' + ch);
}

function escapeWindows(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

export function formatPathsForInsert(paths: string[], platform: NodeJS.Platform): string {
  const escape = platform === 'win32' ? escapeWindows : escapePosix;
  const parts = paths.filter((p) => p && p.length > 0).map(escape);
  if (parts.length === 0) return '';
  return parts.join(' ') + ' ';
}
