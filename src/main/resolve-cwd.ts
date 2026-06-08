import { homedir } from 'os';
import { statSync } from 'fs';
import { join } from 'path';

/**
 * Expand a leading `~` to the home directory. Pure string transform — does NOT
 * touch the filesystem, so it is safe for building paths (unlike resolveCwd,
 * which substitutes home for dirs that do not exist). The OS never expands `~`
 * itself, so any cwd that may carry the literal tilde (e.g. a fresh workspace's
 * default cwd) must pass through here before being handed to fs calls.
 */
export function expandTilde(cwd: string | undefined | null): string {
  const home = homedir();
  const dir = (cwd ?? '').trim();
  if (dir === '' || dir === '~') return home;
  if (dir === '~/' || dir.startsWith('~/')) return join(home, dir.slice(2));
  return dir;
}

/**
 * Resolve a workspace cwd into a real, existing absolute directory for a PTY.
 * Expands a leading `~` to the home directory and falls back to home when the
 * value is empty or points at a directory that does not exist. This guarantees
 * node-pty never receives an invalid cwd (which makes the shell exit code 1).
 */
export function resolveCwd(cwd: string | undefined | null): string {
  const home = homedir();
  const dir = expandTilde(cwd);
  try {
    return statSync(dir).isDirectory() ? dir : home;
  } catch {
    return home;
  }
}
