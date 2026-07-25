import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadScrollbackFromFile,
  saveScrollbackToFile,
  deserializeScrollback,
  truncateScrollback,
  MAX_SCROLLBACK_CHARS,
  ScrollbackStore
} from '../src/main/scrollback';

// Every temp dir handed out here is removed after the test. Callers used to
// rmSync only the file inside, which left the containing dir in the system temp
// folder on every run — hundreds accumulated over time.
const tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-sb-'));
  tmpDirs.push(dir);
  return dir;
}

function tmpFile(): string {
  return join(tmpDir(), 'scrollback.json');
}

afterEach(() => {
  while (tmpDirs.length) rmSync(tmpDirs.pop()!, { recursive: true, force: true });
});

describe('scrollback file IO', () => {
  it('returns empty map when file is missing', () => {
    expect(loadScrollbackFromFile('/nonexistent/path/scrollback.json')).toEqual({});
  });

  it('saves then loads identical map', () => {
    const file = tmpFile();
    const map = { p1: 'hello\r\n', p2: 'world\r\n' };
    saveScrollbackToFile(file, map);
    expect(loadScrollbackFromFile(file)).toEqual(map);
    rmSync(file, { force: true });
  });

  it('returns empty map for invalid JSON', () => {
    expect(deserializeScrollback('not json')).toEqual({});
  });

  it('returns empty map when JSON is not a string→string record', () => {
    expect(deserializeScrollback(JSON.stringify(['a', 'b']))).toEqual({});
    expect(deserializeScrollback(JSON.stringify({ p1: 123 }))).toEqual({});
    expect(deserializeScrollback(JSON.stringify(42))).toEqual({});
  });

  it('returns empty map when read fails (path is a directory)', () => {
    expect(loadScrollbackFromFile(tmpDir())).toEqual({});
  });
});

describe('truncateScrollback', () => {
  it('leaves short input unchanged', () => {
    expect(truncateScrollback('short')).toBe('short');
  });

  it('keeps the tail and drops the partial first line when over the cap', () => {
    const head = 'a'.repeat(MAX_SCROLLBACK_CHARS);
    const data = head + '\nLINE2\nLINE3';
    const out = truncateScrollback(data);
    expect(out.length).toBeLessThanOrEqual(MAX_SCROLLBACK_CHARS);
    expect(out).toBe('LINE2\nLINE3');
    expect(out.startsWith('a')).toBe(false);
  });

  it('falls back to a raw tail slice when no newline is present in the kept window', () => {
    const data = 'x'.repeat(MAX_SCROLLBACK_CHARS + 100);
    const out = truncateScrollback(data);
    expect(out.length).toBe(MAX_SCROLLBACK_CHARS);
  });
});

describe('ScrollbackStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores and retrieves per-pane scrollback, persisting to disk', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file);
    store.set('p1', 'output one');
    expect(store.get('p1')).toBe('output one');
    store.flush();
    // A fresh store reading the same file sees the persisted value.
    expect(new ScrollbackStore(file).get('p1')).toBe('output one');
    rmSync(file, { force: true });
  });

  it('batches multiple set calls into one delayed disk write', () => {
    vi.useFakeTimers();
    const file = tmpFile();
    const store = new ScrollbackStore(file, { flushDelayMs: 1000 });

    store.set('p1', 'first');
    store.set('p1', 'second');
    expect(new ScrollbackStore(file).get('p1')).toBeUndefined();

    vi.advanceTimersByTime(999);
    expect(new ScrollbackStore(file).get('p1')).toBeUndefined();

    vi.advanceTimersByTime(1);
    expect(new ScrollbackStore(file).get('p1')).toBe('second');
    rmSync(file, { force: true });
  });

  it('truncates on set', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file);
    store.set('p1', 'b'.repeat(MAX_SCROLLBACK_CHARS + 50));
    expect(store.get('p1')!.length).toBeLessThanOrEqual(MAX_SCROLLBACK_CHARS);
    rmSync(file, { force: true });
  });

  it('clear removes a pane and persists', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file);
    store.set('p1', 'x');
    store.clear('p1');
    expect(store.get('p1')).toBeUndefined();
    store.flush();
    expect(new ScrollbackStore(file).get('p1')).toBeUndefined();
    rmSync(file, { force: true });
  });

  it('prune keeps live panes and drops orphans', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file);
    store.set('keep', 'a');
    store.set('orphan', 'b');
    store.prune(['keep']);
    expect(store.get('keep')).toBe('a');
    expect(store.get('orphan')).toBeUndefined();
    store.flush();
    expect(new ScrollbackStore(file).get('orphan')).toBeUndefined();
    rmSync(file, { force: true });
  });

  it('initializes from an existing file', () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ p1: 'preexisting' }), 'utf8');
    expect(new ScrollbackStore(file).get('p1')).toBe('preexisting');
    rmSync(file, { force: true });
  });

  it('records nothing while disabled', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file, { enabled: false });
    store.set('p1', 'output one');
    expect(store.get('p1')).toBeUndefined();
    store.flush();
    expect(new ScrollbackStore(file).get('p1')).toBeUndefined();
  });

  it('wipes an existing file when constructed disabled', () => {
    const file = tmpFile();
    writeFileSync(file, JSON.stringify({ p1: 'leftover' }), 'utf8');
    const store = new ScrollbackStore(file, { enabled: false });
    expect(store.get('p1')).toBeUndefined();
    // Sofort geschrieben, nicht erst beim Flush: ein Absturz vor dem Quit darf
    // die abbestellten Terminal-Inhalte nicht auf der Platte zurücklassen.
    expect(loadScrollbackFromFile(file)).toEqual({});
  });

  it('setEnabled(false) drops everything and empties the file', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file);
    store.set('p1', 'output one');
    store.flush();
    expect(loadScrollbackFromFile(file)).toEqual({ p1: 'output one' });

    store.setEnabled(false);
    expect(store.get('p1')).toBeUndefined();
    expect(loadScrollbackFromFile(file)).toEqual({});
  });

  it('setEnabled(true) resumes recording', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file, { enabled: false });
    store.set('p1', 'ignored');
    store.setEnabled(true);
    store.set('p1', 'kept');
    store.flush();
    expect(new ScrollbackStore(file).get('p1')).toBe('kept');
  });

  it('setEnabled with the unchanged value does not touch the file', () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file);
    store.set('p1', 'output one');
    store.flush();
    store.setEnabled(true);
    expect(loadScrollbackFromFile(file)).toEqual({ p1: 'output one' });
  });

  it('cancels a pending write when disabled mid-debounce', async () => {
    const file = tmpFile();
    const store = new ScrollbackStore(file, { flushDelayMs: 10 });
    // Content alone can't tell "cancelled" apart from "not cancelled" here:
    // wipe() clears the in-memory map before it persists, so even an
    // uncancelled stale timer would just re-persist that same empty map a
    // moment later — same bytes on disk either way. Spy on the private
    // persist() to also assert *how many times* the file gets written.
    const persistSpy = vi.spyOn(store as unknown as { persist: () => void }, 'persist');

    store.set('p1', 'output one');   // debounce armed, nothing on disk yet
    store.setEnabled(false);
    await new Promise((r) => setTimeout(r, 40));

    expect(loadScrollbackFromFile(file)).toEqual({});
    // Exactly one write (wipe's own synchronous persist). A missing
    // cancellation would let the pre-existing debounce timer fire ~10ms
    // later and persist a second time.
    expect(persistSpy).toHaveBeenCalledTimes(1);
  });
});
