import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { armTaskWatcher } from '../src/main/task-watcher';

const dirs: string[] = [];
const makeDir = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'dmws-watch-'));
  dirs.push(d);
  return d;
};

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('armTaskWatcher', () => {
  it('reports the changed filename', async () => {
    const dir = makeDir();
    const seen: (string | null)[] = [];
    const w = armTaskWatcher(dir, (name) => seen.push(name));
    try {
      // kqueue needs a moment to arm; a write issued in the same tick is missed.
      // Keep writing until the event lands so the test cannot race the watcher.
      const writer = setInterval(() => writeFileSync(join(dir, 'TASKS.md'), String(Date.now()), 'utf8'), 50);
      try {
        await expect.poll(() => seen.includes('TASKS.md'), { timeout: 5000 }).toBe(true);
      } finally {
        clearInterval(writer);
      }
    } finally {
      w?.close();
    }
  });

  // fs.watch reports runtime failures asynchronously. With no 'error' listener
  // Node rethrows them as an uncaught exception, which Electron surfaces as a
  // main-process crash dialog — a dead watcher must never take the app down.
  it('swallows a runtime watcher error instead of throwing', () => {
    const dir = makeDir();
    const w = armTaskWatcher(dir, () => {});
    expect(w).not.toBeNull();
    expect(() => w!.emit('error', new Error('EMFILE: too many open files, watch'))).not.toThrow();
  });

  it('hands the error to the caller so it can stop using the watcher', () => {
    const dir = makeDir();
    const errors: Error[] = [];
    const w = armTaskWatcher(dir, () => {}, (err) => errors.push(err));
    w!.emit('error', new Error('EMFILE'));
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('EMFILE');
  });

  it('returns null when the folder cannot be watched at all', () => {
    expect(armTaskWatcher(join(tmpdir(), 'dmws-does-not-exist-xyz'), () => {})).toBeNull();
  });
});
