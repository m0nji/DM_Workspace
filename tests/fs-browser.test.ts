import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, chmodSync, statSync, lstatSync, symlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import {
  readDir, readTextFile, writeTextFile, createFile, MAX_TEXT_BYTES, FsBrowserError
} from '../src/main/fs-browser';

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'dmws-fsb-'));
}

describe('readDir', () => {
  it('lists entries with folders first, then case-insensitive alpha', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'zeta'));
    mkdirSync(join(dir, 'Alpha'));
    writeFileSync(join(dir, 'banana.txt'), 'x');
    writeFileSync(join(dir, 'Apple.md'), 'y');
    const names = readDir(dir).map((e) => e.name);
    expect(names).toEqual(['Alpha', 'zeta', 'Apple.md', 'banana.txt']);
    rmSync(dir, { recursive: true, force: true });
  });

  it('reports isDir and size', () => {
    const dir = tmp();
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'f.txt'), 'hello');
    const entries = readDir(dir);
    const sub = entries.find((e) => e.name === 'sub')!;
    const f = entries.find((e) => e.name === 'f.txt')!;
    expect(sub.isDir).toBe(true);
    expect(f.isDir).toBe(false);
    expect(f.size).toBe(5);
    rmSync(dir, { recursive: true, force: true });
  });

  it('expands a leading ~ to the home directory', () => {
    expect(readDir('~').map((e) => e.name)).toEqual(readDir(homedir()).map((e) => e.name));
  });
});

describe('readTextFile', () => {
  it('returns UTF-8 contents of a text file', () => {
    const dir = tmp();
    const file = join(dir, 'note.txt');
    writeFileSync(file, 'grüß dich', 'utf8');
    expect(readTextFile(file)).toBe('grüß dich');
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws a binary error on NUL bytes', () => {
    const dir = tmp();
    const file = join(dir, 'bin');
    writeFileSync(file, Buffer.from([0x41, 0x00, 0x42]));
    let caught: unknown;
    try { readTextFile(file); } catch (e) { caught = e; }
    expect(caught).toBeInstanceOf(FsBrowserError);
    expect((caught as FsBrowserError).code).toBe('binary');
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws too-large past the cap', () => {
    const dir = tmp();
    const file = join(dir, 'big.txt');
    writeFileSync(file, 'x'.repeat(MAX_TEXT_BYTES + 1), 'utf8');
    try { readTextFile(file); throw new Error('should have thrown'); }
    catch (e) { expect((e as FsBrowserError).code).toBe('too-large'); }
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('writeTextFile', () => {
  it('writes content and round-trips', () => {
    const dir = tmp();
    const file = join(dir, 'out.txt');
    writeTextFile(file, 'line one\nline two');
    expect(readFileSync(file, 'utf8')).toBe('line one\nline two');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('createFile', () => {
  it('creates an empty file and returns its path', () => {
    const dir = tmp();
    const p = createFile(dir, 'new.txt');
    expect(p).toBe(join(dir, 'new.txt'));
    expect(readFileSync(p, 'utf8')).toBe('');
    rmSync(dir, { recursive: true, force: true });
  });

  it('throws exists when the file already exists', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'dup.txt'), 'x');
    try { createFile(dir, 'dup.txt'); throw new Error('should have thrown'); }
    catch (e) { expect((e as FsBrowserError).code).toBe('exists'); }
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects names containing a path separator or ..', () => {
    const dir = tmp();
    for (const bad of ['../escape', 'a/b', '..', '']) {
      try { createFile(dir, bad); throw new Error(`should have thrown for ${bad}`); }
      catch (e) { expect((e as FsBrowserError).code).toBe('invalid-name'); }
    }
    rmSync(dir, { recursive: true, force: true });
  });
});

const posixIt = it.skipIf(process.platform === 'win32');

describe('writeTextFile leaves the file the way the user had it', () => {
  posixIt('keeps the permission bits of an executable script', () => {
    const dir = tmp();
    const file = join(dir, 'run.sh');
    writeFileSync(file, '#!/bin/sh\n');
    chmodSync(file, 0o755);
    writeTextFile(file, '#!/bin/sh\necho hi\n');
    expect(statSync(file).mode & 0o777).toBe(0o755);
    rmSync(dir, { recursive: true, force: true });
  });

  posixIt('keeps a private file private', () => {
    const dir = tmp();
    const file = join(dir, '.env');
    writeFileSync(file, 'A=1\n');
    chmodSync(file, 0o600);
    writeTextFile(file, 'A=2\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  posixIt('writes through a symlink instead of replacing the link', () => {
    const dir = tmp();
    const real = join(dir, 'real.txt');
    const link = join(dir, 'link.txt');
    writeFileSync(real, 'old');
    symlinkSync(real, link);
    writeTextFile(link, 'new');
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, 'utf8')).toBe('new');
    rmSync(dir, { recursive: true, force: true });
  });

  it('still creates a file that does not exist yet', () => {
    const dir = tmp();
    const file = join(dir, 'neu.txt');
    writeTextFile(file, 'hallo');
    expect(readFileSync(file, 'utf8')).toBe('hallo');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('readTextFile refuses what it cannot round-trip', () => {
  it('rejects a Latin-1 file instead of decoding it lossily', () => {
    const dir = tmp();
    const file = join(dir, 'alt.csv');
    writeFileSync(file, Buffer.from([0x63, 0x61, 0x66, 0xe9])); // "café" in Latin-1
    let err: unknown;
    try { readTextFile(file); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(FsBrowserError);
    // Eigener Code: eine CP1252-Textdatei ist keine Binärdatei, und die UI soll
    // das nicht behaupten.
    expect((err as FsBrowserError).code).toBe('not-utf8');
    rmSync(dir, { recursive: true, force: true });
  });

  it('still calls a file with NUL bytes binary', () => {
    const dir = tmp();
    const file = join(dir, 'data.bin');
    writeFileSync(file, Buffer.from([0x50, 0x4b, 0x00, 0x03]));
    let err: unknown;
    try { readTextFile(file); } catch (e) { err = e; }
    expect((err as FsBrowserError).code).toBe('binary');
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads valid UTF-8 with umlauts unchanged', () => {
    const dir = tmp();
    const file = join(dir, 'ok.txt');
    writeFileSync(file, 'Grüße, Öl & Äpfel', 'utf8');
    expect(readTextFile(file)).toBe('Grüße, Öl & Äpfel');
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps a UTF-8 byte order mark so that a save does not drop it', () => {
    const dir = tmp();
    const file = join(dir, 'bom.txt');
    writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('x')]));
    expect(readTextFile(file).startsWith('\uFEFF')).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
