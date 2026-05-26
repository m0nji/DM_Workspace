import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// Per-pane terminal scrollback, keyed by the (restart-stable) pane id.
export type ScrollbackMap = Record<string, string>;

// Cap stored scrollback per pane so scrollback.json can't grow without bound.
// This is characters, not bytes; xterm output is overwhelmingly ASCII so the two
// are close, and a generous cap keeps several screens of history per pane.
export const MAX_SCROLLBACK_CHARS = 256 * 1024;

// Keep the most recent tail of `data`. When trimming, drop the (now partial)
// first line so we don't start replay in the middle of an ANSI escape sequence
// — escape sequences don't span newlines, so cutting on a newline is safe.
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
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(map), 'utf8');
  } catch (err) {
    console.error(`Failed to save scrollback to ${file}:`, err);
  }
}

// Holds the scrollback map in memory and writes through to disk on every change.
// Writes are infrequent (the renderer debounces saves), so write-through is fine.
export class ScrollbackStore {
  private map: ScrollbackMap;

  constructor(private readonly file: string) {
    this.map = loadScrollbackFromFile(file);
  }

  get(paneId: string): string | undefined {
    return this.map[paneId];
  }

  set(paneId: string, data: string): void {
    this.map[paneId] = truncateScrollback(data);
    this.persist();
  }

  clear(paneId: string): void {
    if (paneId in this.map) {
      delete this.map[paneId];
      this.persist();
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
    if (changed) this.persist();
  }

  private persist(): void {
    saveScrollbackToFile(this.file, this.map);
  }
}
