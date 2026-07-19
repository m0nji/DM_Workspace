import { watch, type FSWatcher } from 'node:fs';

// Arms an fs.watch on the task folder.
//
// fs.watch reports runtime failures — descriptor exhaustion (EMFILE), the folder
// being removed or renamed underneath us — asynchronously via an 'error' event,
// NOT by throwing from watch(). With no listener attached Node rethrows it as an
// uncaught exception, which in Electron pops the "A JavaScript error occurred in
// the main process" dialog and takes the whole app down. Losing the watcher only
// costs live board reloads (an external edit no longer refreshes until the next
// load/save), so we close it and let the caller carry on.
//
// Returns null when the folder cannot be watched at all — .dmworkspace may not
// exist yet, and the next tasks:save re-arms it.
export function armTaskWatcher(
  dir: string,
  onChange: (name: string | null) => void,
  onError?: (err: Error) => void
): FSWatcher | null {
  try {
    const watcher = watch(dir, (_evt, name) => onChange(name ? name.toString() : null));
    watcher.on('error', (err: Error) => {
      try { watcher.close(); } catch { /* already torn down */ }
      onError?.(err);
    });
    return watcher;
  } catch {
    return null;
  }
}
