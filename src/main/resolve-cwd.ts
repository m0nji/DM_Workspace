import { homedir } from 'os';
import { existsSync } from 'fs';
import { join } from 'path';

/**
 * Resolve a workspace cwd into a real, existing absolute directory for a PTY.
 * Expands a leading `~` to the home directory and falls back to home when the
 * value is empty or points at a directory that does not exist. This guarantees
 * node-pty never receives an invalid cwd (which makes the shell exit code 1).
 */
export function resolveCwd(cwd: string | undefined | null): string {
  const home = homedir();
  let dir = (cwd ?? '').trim();
  if (dir === '' || dir === '~') {
    dir = home;
  } else if (dir === '~/' || dir.startsWith('~/')) {
    dir = join(home, dir.slice(2));
  }
  return existsSync(dir) ? dir : home;
}
