import { describe, it, expect, vi } from 'vitest';
import { killAndWait, type KillableProc } from '../src/main/pty-shutdown';

// A fake pty whose exit we drive manually, so we can assert killAndWait waits
// for the real onExit before resolving (the thing that prevents the abort crash).
function fakeProc(): KillableProc & { fireExit: () => void; killed: boolean } {
  let listener: ((e: { exitCode: number; signal?: number }) => void) | null = null;
  return {
    killed: false,
    onExit(cb: (e: { exitCode: number; signal?: number }) => void) {
      listener = cb;
      return undefined;
    },
    kill() {
      this.killed = true;
    },
    fireExit() {
      listener?.({ exitCode: 0 });
    }
  };
}

describe('killAndWait', () => {
  it('resolves immediately when there are no ptys', async () => {
    await expect(killAndWait([], 1000)).resolves.toBeUndefined();
  });

  it('kills every proc and resolves only after all have exited', async () => {
    const a = fakeProc();
    const b = fakeProc();
    let resolved = false;
    const done = killAndWait([a, b], 1000).then(() => { resolved = true; });

    expect(a.killed).toBe(true);
    expect(b.killed).toBe(true);

    a.fireExit();
    await Promise.resolve();
    expect(resolved).toBe(false); // b is still alive

    b.fireExit();
    await done;
    expect(resolved).toBe(true);
  });

  it('resolves on timeout even if a pty never reports exit', async () => {
    vi.useFakeTimers();
    try {
      const stuck = fakeProc();
      let resolved = false;
      const done = killAndWait([stuck], 1500).then(() => { resolved = true; });

      await vi.advanceTimersByTimeAsync(1499);
      expect(resolved).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(resolved).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not hang if kill throws (treats it as already exited)', async () => {
    const throwing: KillableProc = {
      onExit() { return undefined; },
      kill() { throw new Error('already dead'); }
    };
    await expect(killAndWait([throwing], 1000)).resolves.toBeUndefined();
  });
});
