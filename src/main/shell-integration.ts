import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// Raw control bytes for the OSC 7 cwd report. ESC ] 7 ; file://HOST PATH BEL.
const ESC = '\x1b';
const BEL = '\x07';

// bash: the cwd-reporting command goes into the PROMPT_COMMAND *environment
// variable*, which bash runs before each prompt. Inheriting it via env avoids
// echoing a typed command into the terminal (the old stdin-injection did).
// $HOSTNAME/$PWD are expanded by bash at prompt time, so they stay as literals
// here; the ESC/BEL are raw bytes (env values are not shell-parsed).
export function bashPromptCommand(): string {
  return `printf '${ESC}]7;file://%s%s${BEL}' "$HOSTNAME" "$PWD"`;
}

// zsh has no equivalent env hook, so we point ZDOTDIR at a generated dir holding
// forwarding startup files. Each forwards to the user's real startup file (under
// _DMWS_USER_ZDOTDIR, set in the spawn env); .zshrc additionally registers the
// precmd hook. .zshenv re-pins ZDOTDIR to our dir *after* sourcing the user's
// .zshenv, so a user .zshenv that changes ZDOTDIR can't divert the later files.
// The integration dir path is embedded as a literal because we generate the file.
export function zshIntegrationFiles(dir: string): Record<string, string> {
  const source = (name: string) =>
    `[ -f "$_DMWS_USER_ZDOTDIR/${name}" ] && . "$_DMWS_USER_ZDOTDIR/${name}"\n`;
  // POSIX-safe single-quote escaping for embedding dir inside a '...' literal:
  // a single quote becomes '\'' (close quote, escaped quote, reopen quote).
  const quotedDir = dir.replace(/'/g, `'\\''`);
  return {
    '.zshenv': source('.zshenv') + `ZDOTDIR='${quotedDir}'\n`,
    '.zprofile': source('.zprofile'),
    '.zshrc':
      source('.zshrc') +
      `__dmws_cwd(){ printf '${ESC}]7;file://%s%s${BEL}' "$HOST" "$PWD"; }\n` +
      `precmd_functions+=(__dmws_cwd)\n`,
    '.zlogin': source('.zlogin')
  };
}

// Write the zsh integration files into `dir` (created if needed) and return the
// dir. Idempotent — safe to call once per app launch.
export function writeZshIntegrationDir(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const files = zshIntegrationFiles(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}
