import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { DMWS_PROMPT_OSC, promptPayload, promptSequence } from '../shared/pane-auto-title';
import { PSREADLINE_HEAL_CHORD } from '../shared/psreadline-heal';

// Raw control bytes for the OSC 7 cwd report. ESC ] 7 ; file://HOST PATH BEL.
const ESC = '\x1b';
const BEL = '\x07';

// The renderer's handle on PSReadLine's broken input column: bind
// InvokePrompt() — the only routine that re-reads it from Console.CursorLeft —
// to a key nobody can press by accident, so we can press it after a widening
// resize. See src/shared/psreadline-heal.ts for why this is needed at all.
//
// Everything here is defensive because this string also runs where PSReadLine
// is not: an older host, a stripped-down system, a foreign shell that happens
// to be named powershell.exe. `Get-Command` (which also triggers the module
// auto-load) decides, the outer try/catch swallows whatever it misses, and the
// handler body has its own try/catch — a failing key handler would otherwise
// paint a red error over the pane on every heal. The `-notcontains` guard keeps
// a user who already bound F24 in charge of their own key.
const psReadLineHeal =
  'try{if(Get-Command Set-PSReadLineKeyHandler -ErrorAction SilentlyContinue){' +
  `if((Get-PSReadLineKeyHandler -Bound).Key -notcontains '${PSREADLINE_HEAL_CHORD}'){` +
  `Set-PSReadLineKeyHandler -Chord '${PSREADLINE_HEAL_CHORD}' -ScriptBlock ` +
  '{try{[Microsoft.PowerShell.PSConsoleReadLine]::InvokePrompt()}catch{}}}}}catch{}';

// PowerShell bootstrap that makes every prompt emit OSC 9;9 with the current
// filesystem path, so the renderer can show the live cwd in the pane title. It
// wraps (rather than replaces) the existing prompt, so a custom prompt is kept.
// $([char]27) = ESC, $([char]7) = BEL (the OSC terminator). Passed as a single
// argv element, so no extra shell-quoting is needed — which is also why this
// has to stay a single line with no embedded newlines.
export function psCwdBootstrap(nonce: string): string {
  return "if(-not $global:__dmwsPrompt){$global:__dmwsPrompt=$function:prompt};" +
    "function global:prompt{$o=& $global:__dmwsPrompt;" +
    `"$([char]27)]9;9;$($PWD.ProviderPath)$([char]7)$([char]27)]${DMWS_PROMPT_OSC};${promptPayload(nonce)}$([char]7)$o"};` +
    psReadLineHeal;
}

// Shells we know accept `-l` (login shell). POSIX shells get `-l` so
// /etc/zprofile (path_helper) and the user's profile run — exactly like
// Terminal.app; a GUI-launched app otherwise inherits a minimal PATH.
const POSIX_SHELLS = new Set(['bash', 'zsh', 'fish', 'sh', 'dash', 'ksh']);

// Spawn args for the shell we actually launch — NOT for the platform. A custom
// shell (cmd.exe, git-bash) must never receive the PowerShell bootstrap flags.
export function shellArgs(shell: string, nonce: string): string[] {
  // Manual basename: node's posix basename would not split a Windows path.
  const base = (shell.split(/[\\/]/).pop() ?? shell).toLowerCase().replace(/\.exe$/, '');
  if (base === 'powershell' || base === 'pwsh') return ['-NoExit', '-Command', psCwdBootstrap(nonce)];
  if (base === 'cmd') return []; // cmd.exe has no -l and would choke on PS flags
  if (POSIX_SHELLS.has(base)) return ['-l'];
  // Unknown shell: assume login-shell support on POSIX (the previous behaviour
  // for every $SHELL); pass nothing on Windows (cmd.exe & friends have no -l).
  return process.platform === 'win32' ? [] : ['-l'];
}

// bash: the cwd-reporting command goes into the PROMPT_COMMAND *environment
// variable*, which bash runs before each prompt. Inheriting it via env avoids
// echoing a typed command into the terminal (the old stdin-injection did).
// $HOSTNAME/$PWD are expanded by bash at prompt time, so they stay as literals
// here; the ESC/BEL are raw bytes (env values are not shell-parsed).
export function bashPromptCommand(nonce: string): string {
  return `printf '${ESC}]7;file://%s%s${BEL}${promptSequence(nonce)}' "$HOSTNAME" "$PWD"`;
}

// zsh has no equivalent env hook, so we point ZDOTDIR at a generated dir holding
// forwarding startup files. Each forwards to the user's real startup file (under
// _DMWS_USER_ZDOTDIR, set in the spawn env); .zshrc additionally registers the
// precmd hook. .zshenv re-pins ZDOTDIR to our dir *after* sourcing the user's
// .zshenv, so a user .zshenv that changes ZDOTDIR can't divert the later files.
// The integration dir path is embedded as a literal because we generate the file.
export function zshIntegrationFiles(dir: string, nonce: string): Record<string, string> {
  const source = (name: string) =>
    `case "$_DMWS_USER_ZDOTDIR" in ""|"$ZDOTDIR"|*/shell-integration/zsh) ;; *) [ -f "$_DMWS_USER_ZDOTDIR/${name}" ] && . "$_DMWS_USER_ZDOTDIR/${name}" ;; esac\n`;
  // POSIX-safe single-quote escaping for embedding dir inside a '...' literal:
  // a single quote becomes '\'' (close quote, escaped quote, reopen quote).
  const quotedDir = dir.replace(/'/g, `'\\''`);
  return {
    '.zshenv': source('.zshenv') + `ZDOTDIR='${quotedDir}'\n`,
    '.zprofile': source('.zprofile'),
    '.zshrc':
      source('.zshrc') +
      `__dmws_cwd(){ printf '${ESC}]7;file://%s%s${BEL}${promptSequence(nonce)}' "$HOST" "$PWD"; }\n` +
      `precmd_functions+=(__dmws_cwd)\n`,
    '.zlogin': source('.zlogin')
  };
}

// Write the zsh integration files into `dir` (created if needed) and return the
// dir. Idempotent — safe to call once per app launch.
export function writeZshIntegrationDir(dir: string, nonce: string): string {
  mkdirSync(dir, { recursive: true });
  const files = zshIntegrationFiles(dir, nonce);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

// macOS ships GNU screen 4.00.03, whose MAXTERMLEN is 20. With our TERM of
// xterm-256color, screen names each window's TERM "screen.xterm-256color" (21
// chars), so any screen invoked from *inside* that session — reattaching with
// `screen -r`, opening a second serial console, or plain nesting — aborts with
// "$TERM too long - sorry." (the very thing users hit on a long router session).
// Pointing $SCREENRC at this file forces the standard 15-char `screen-256color`
// window TERM instead, which stays under the limit and keeps 256 colors inside
// screen. `term` comes first so a `term ...` in the user's own rc still wins; we
// then forward their existing screenrc so this stays transparent. `userScreenrc`
// is the absolute path to forward, or null when the user has none.
export function screenrcContent(userScreenrc: string | null): string {
  let out = 'term screen-256color\n';
  if (userScreenrc) {
    // screen parses double-quoted strings with backslash escaping.
    const quoted = userScreenrc.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    out += `source "${quoted}"\n`;
  }
  return out;
}

// Write the screenrc into `dir` (created if needed) and return its path.
// Idempotent — safe to call once per app launch.
export function writeScreenIntegration(dir: string, userScreenrc: string | null): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'screenrc');
  writeFileSync(path, screenrcContent(userScreenrc), 'utf8');
  return path;
}
