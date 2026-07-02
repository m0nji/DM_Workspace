import { writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

// Atomic write: temp sibling then rename, so a crash mid-write (app quit during
// auto-update, power loss) can never leave a truncated file behind — the loaders
// fall back to defaults on a corrupt file, which would silently drop user data.
// Creates the parent directory on demand.
export function writeFileAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.dmws-tmp-${randomUUID()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, file);
}
