import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from 'fs';
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

  it('replaces an existing file completely', () => {
    const file = join(dir, 'f.txt');
    writeFileSync(file, 'a much longer previous content', 'utf8');
    writeFileAtomic(file, 'short');
    expect(readFileSync(file, 'utf8')).toBe('short');
    expect(readdirSync(dir)).toEqual(['f.txt']);
  });
});
