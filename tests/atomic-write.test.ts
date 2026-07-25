import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
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

  it('replaces an existing file completely', () => {
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'a much longer previous content', 'utf8');
    writeFileAtomic(file, 'short');
    expect(readFileSync(file, 'utf8')).toBe('short');
    expect(readdirSync(dir)).toEqual(['f.txt']);
  });
});
