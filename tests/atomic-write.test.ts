import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, renameSync as realRename, statSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFileAtomic } from '../src/main/atomic-write';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dmatomic-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('writeFileAtomic', () => {
  it('writes the content and leaves no temp sibling behind', () => {
    const file = join(dir, 'state.json');
    writeFileAtomic(file, '{"a":1}');
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(readdirSync(dir)).toEqual(['state.json']);
  });

  it('creates missing parent directories', () => {
    const file = join(dir, 'nested', 'deeper', 'TASKS.md');
    writeFileAtomic(file, '## Todo\n');
    expect(readFileSync(file, 'utf8')).toBe('## Todo\n');
  });

  // POSIX only: Windows has no mode bits to assert (chmod there only toggles
  // the read-only flag), and the ACL is what governs access.
  it.skipIf(process.platform === 'win32')('applies a requested restrictive mode to the final file', () => {
    const file = join(dir, 'scrollback.json');
    writeFileAtomic(file, '{"pane":"secret"}', { mode: 0o600 });
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')('leaves the default mode alone when none is requested', () => {
    const file = join(dir, 'TASKS.md');
    writeFileAtomic(file, '## Todo\n');
    // Whatever the umask yields — just not the locked-down mode above.
    expect(statSync(file).mode & 0o077).not.toBe(0);
  });

  // Windows publishes the temp file with MoveFileEx, which fails while another
  // process holds the target open — on a Windows box that is routine: the
  // virus scanner opens each freshly written file. The write is not
  // recoverable by the caller (saveScrollbackToFile only logs), so a scan
  // landing on the wrong millisecond silently dropped a save, and the next
  // launch restored stale or missing scrollback. A short retry rides it out.
  it('retries a rename that fails because the target is briefly locked', () => {
    const file = join(dir, 'scrollback.json');
    writeFileSync(file, 'previous', 'utf8');

    let attempts = 0;
    const failing = (from: string, to: string): void => {
      attempts++;
      if (attempts <= 2) {
        const err = new Error('EPERM: operation not permitted, rename') as NodeJS.ErrnoException;
        err.code = 'EPERM';
        throw err;
      }
      realRename(from, to);
    };

    writeFileAtomic(file, 'fresh', { rename: failing, retryDelayMs: 0 });

    expect(attempts).toBe(3);
    expect(readFileSync(file, 'utf8')).toBe('fresh');
    expect(readdirSync(dir)).toEqual(['scrollback.json']);
  });

  it('gives up and cleans up when the lock does not clear', () => {
    const file = join(dir, 'state.json');
    const failing = (): void => {
      const err = new Error('EBUSY: resource busy or locked, rename') as NodeJS.ErrnoException;
      err.code = 'EBUSY';
      throw err;
    };

    expect(() => writeFileAtomic(file, 'x', { rename: failing, retryDelayMs: 0 })).toThrow('EBUSY');
    // No temp sibling left behind for the user to find.
    expect(readdirSync(dir)).toEqual([]);
  });

  it('does not retry a failure that will not pass, and reports it', () => {
    const file = join(dir, 'state.json');
    let attempts = 0;
    const failing = (): void => {
      attempts++;
      const err = new Error('ENOSPC: no space left on device, rename') as NodeJS.ErrnoException;
      err.code = 'ENOSPC';
      throw err;
    };

    expect(() => writeFileAtomic(file, 'x', { rename: failing, retryDelayMs: 0 })).toThrow('ENOSPC');
    expect(attempts).toBe(1);
  });

  it('replaces an existing file completely', () => {
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'a much longer previous content', 'utf8');
    writeFileAtomic(file, 'short');
    expect(readFileSync(file, 'utf8')).toBe('short');
    expect(readdirSync(dir)).toEqual(['f.txt']);
  });
});
