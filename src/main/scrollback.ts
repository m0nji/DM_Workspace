import { readFileSync } from 'fs';
import { writeFileAtomic } from './atomic-write';

// Per-pane terminal scrollback, keyed by the (restart-stable) pane id.
export type ScrollbackMap = Record<string, string>;

// Backstop cap so scrollback.json can't grow without bound. The primary cap is
// in the renderer (SerializeAddon's `scrollback: 1000` line limit); this is a
// generous secondary guard in case the terminal's scrollback depth is raised.
// The stored data is the renderer's serialized buffer — rows of text with inline
// SGR color escapes, separated by newlines.
export const MAX_SCROLLBACK_CHARS = 256 * 1024;
const DEFAULT_FLUSH_DELAY_MS = 1000;

// Keep the most recent tail of `data`. When trimming, drop the (now partial)
// first line so we cut on a row boundary: serialized rows are newline-separated
// and SGR escapes stay within a row, so cutting on a newline never splits one.
export function truncateScrollback(data: string, maxChars = MAX_SCROLLBACK_CHARS): string {
  if (data.length <= maxChars) return data;
  const tail = data.slice(data.length - maxChars);
  const nl = tail.indexOf('\n');
  return nl >= 0 ? tail.slice(nl + 1) : tail;
}

function isStringRecord(obj: unknown): obj is ScrollbackMap {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return false;
  return Object.values(obj as Record<string, unknown>).every((v) => typeof v === 'string');
}

export function deserializeScrollback(json: string): ScrollbackMap {
  try {
    const parsed = JSON.parse(json);
    return isStringRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function loadScrollbackFromFile(file: string): ScrollbackMap {
  try {
    return deserializeScrollback(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

export function saveScrollbackToFile(file: string, map: ScrollbackMap): void {
  try {
    writeFileAtomic(file, JSON.stringify(map));
  } catch (err) {
    console.error(`Failed to save scrollback to ${file}:`, err);
  }
}

// Holds the scrollback map in memory and batches disk writes so pane output
// bursts do not rewrite scrollback.json on every save event.
export class ScrollbackStore {
  private map: ScrollbackMap;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushDelayMs: number;

  constructor(private readonly file: string, opts: { flushDelayMs?: number } = {}) {
    this.map = loadScrollbackFromFile(file);
    this.flushDelayMs = opts.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
  }

  get(paneId: string): string | undefined {
    return this.map[paneId];
  }

  set(paneId: string, data: string): void {
    this.map[paneId] = truncateScrollback(data);
    this.schedulePersist();
  }

  clear(paneId: string): void {
    if (paneId in this.map) {
      delete this.map[paneId];
      this.schedulePersist();
    }
  }

  // Drop scrollback for panes that no longer exist in any workspace layout.
  prune(liveIds: Iterable<string>): void {
    const keep = new Set(liveIds);
    let changed = false;
    for (const id of Object.keys(this.map)) {
      if (!keep.has(id)) {
        delete this.map[id];
        changed = true;
      }
    }
    if (changed) this.schedulePersist();
  }

  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.persist();
  }

  private schedulePersist(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.persist();
    }, this.flushDelayMs);
  }

  private persist(): void {
    saveScrollbackToFile(this.file, this.map);
  }
}
