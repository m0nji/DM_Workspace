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

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'dmws-sb-')), 'scrollback.json');
}

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
    const dir = mkdtempSync(join(tmpdir(), 'dmws-sb-'));
    expect(loadScrollbackFromFile(dir)).toEqual({});
    rmSync(dir, { recursive: true, force: true });
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
});
