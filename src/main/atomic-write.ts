import { writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Atomic write: temp sibling then rename, so a crash mid-write (app quit during
// auto-update, power loss) can never leave a truncated file behind — the loaders
// fall back to defaults on a corrupt file, which would silently drop user data.
// Creates the parent directory on demand.
export function writeFileAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.dmws-tmp-${randomUUID()}`;
  try {
    writeFileSync(tmp, content, 'utf8');
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
