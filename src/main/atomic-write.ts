import { writeFileSync, renameSync, mkdirSync, rmSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AtomicWriteOptions {
  // Permission bits for the written file. Pass 0o600 for app-private files that
  // can carry credentials (scrollback, persisted state) — without it they land
  // at the process umask default, typically 0o644, i.e. readable by every other
  // account on the machine. Leave unset for files that belong to the user's
  // project (TASKS.md, edited files), whose permissions are not ours to dictate.
  mode?: number;
}

// Atomic write: temp sibling then rename, so a crash mid-write (app quit during
// auto-update, power loss) can never leave a truncated file behind — the loaders
// fall back to defaults on a corrupt file, which would silently drop user data.
// Creates the parent directory on demand.
export function writeFileAtomic(file: string, content: string, options: AtomicWriteOptions = {}): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.dmws-tmp-${randomUUID()}`;
  try {
    writeFileSync(tmp, content, options.mode === undefined ? 'utf8' : { encoding: 'utf8', mode: options.mode });
    // The mode above is masked by the process umask; chmod is not. Applied to
    // the temp file so the mode is already in place when the rename publishes
    // it — never a window where the real file exists world-readable. (On
    // Windows this only toggles the read-only bit; the ACL governs there.)
    if (options.mode !== undefined) chmodSync(tmp, options.mode);
    renameSync(tmp, file);
  } catch (err) {
    // The temp name is unique per call, so a failed rename (locked target on
    // Windows, cross-device, ENOSPC) would strand it next to the real file
    // forever — and these live in the user's workspace (.dmworkspace/TASKS.md)
    // where the litter is visible. Clean up, then report the original failure.
    rmSync(tmp, { force: true });
    throw err;
  }
}
