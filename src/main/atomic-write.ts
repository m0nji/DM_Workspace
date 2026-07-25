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
  // Seams for the tests only — a rename that fails the way Windows fails, and a
  // retry pause that does not cost the suite real time.
  rename?: (from: string, to: string) => void;
  retryDelayMs?: number;
}

// Windows publishes the temp file with MoveFileEx, which refuses while another
// process holds the target open. That is not an exotic case there: the virus
// scanner opens each freshly written file, so a save can collide with the scan
// of the previous one. The callers cannot recover — saveScrollbackToFile and
// saveStateToFile only log — so the write would be silently lost and the next
// launch would restore stale data. These codes clear on their own within
// milliseconds; ENOSPC, EXDEV or a missing directory never will.
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_RETRY_DELAYS_MS = [20, 50, 100];

// Synchronous by necessity: the whole write is, and making it async would let a
// quit or a second save interleave between the temp file and the rename.
function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameWithRetry(
  from: string,
  to: string,
  rename: (from: string, to: string) => void,
  retryDelayMs: number | undefined
): void {
  for (let attempt = 0; ; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (attempt >= RENAME_RETRY_DELAYS_MS.length || !RETRYABLE_RENAME_CODES.has(code)) throw err;
      sleepSync(retryDelayMs ?? RENAME_RETRY_DELAYS_MS[attempt]);
    }
  }
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
    renameWithRetry(tmp, file, options.rename ?? renameSync, options.retryDelayMs);
  } catch (err) {
    // The temp name is unique per call, so a failed rename (a lock on Windows
    // that outlasts the retries, cross-device, ENOSPC) would strand it next to
    // the real file forever — and these live in the user's workspace
    // (.dmworkspace/TASKS.md) where the litter is visible. Clean up, then
    // report the original failure.
    rmSync(tmp, { force: true });
    throw err;
  }
}
