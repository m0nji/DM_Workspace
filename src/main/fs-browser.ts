import { readdirSync, statSync, readFileSync, openSync, closeSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { expandTilde } from './resolve-cwd';
import { writeFileAtomic } from './atomic-write';
import type { DirEntry } from '../shared/types';

// 2 MB cap for inline editing — past this we refuse to load into a <textarea>.
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export type FsBrowserCode = 'binary' | 'not-utf8' | 'too-large' | 'exists' | 'invalid-name';

export class FsBrowserError extends Error {
  constructor(public code: FsBrowserCode, message: string) {
    super(message);
    this.name = 'FsBrowserError';
  }
}

export function readDir(dirPath: string): DirEntry[] {
  const base = expandTilde(dirPath);
  const dirents = readdirSync(base, { withFileTypes: true });
  const entries: DirEntry[] = [];
  for (const d of dirents) {
    const full = join(base, d.name);
    let isDir = d.isDirectory();
    let size = 0;
    let mtimeMs = 0;
    try {
      const st = statSync(full); // follows symlinks for real size/mtime
      isDir = st.isDirectory();
      size = st.size;
      mtimeMs = st.mtimeMs;
    } catch {
      // Broken symlink / race: keep the dirent's type with zeroed stats.
    }
    entries.push({ name: d.name, path: full, isDir, size, mtimeMs });
  }
  entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return entries;
}

// A NUL byte in the first 8 KB is the canonical "binary" heuristic (git uses it).
function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

export function readTextFile(path: string): string {
  const full = expandTilde(path);
  const st = statSync(full);
  if (st.size > MAX_TEXT_BYTES) {
    throw new FsBrowserError('too-large', `File is too large to edit (${st.size} bytes)`);
  }
  const buf = readFileSync(full);
  if (isBinary(buf)) throw new FsBrowserError('binary', 'File appears to be binary');
  // Strikt dekodieren: toString('utf8') macht aus jedem ungültigen Byte ein
  // U+FFFD, und Speichern schriebe das Ersatzzeichen über das Original. Eine
  // Latin-1/CP1252-Datei wird stattdessen schreibgeschützt geöffnet. ignoreBOM:
  // ein vorhandenes BOM bleibt im Text und überlebt damit das Speichern.
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buf);
  } catch {
    throw new FsBrowserError('not-utf8', 'File is not valid UTF-8');
  }
}

export function writeTextFile(path: string, content: string): void {
  let target = expandTilde(path);
  let mode: number | undefined;
  try {
    // Über den Symlink hinweg schreiben und die Rechte des Originals
    // übernehmen: writeFileAtomic ersetzt die Datei per rename und würde sonst
    // Link und Modus (0755, 0600) verlieren. Unter Windows ist der Modus nur
    // das Schreibschutz-Bit, dort bleibt der bisherige Weg.
    target = realpathSync(target);
    if (process.platform !== 'win32') mode = statSync(target).mode & 0o7777;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  writeFileAtomic(target, content, mode === undefined ? {} : { mode });
}

export function createFile(dirPath: string, name: string): string {
  if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..' || name.includes('\0')) {
    throw new FsBrowserError('invalid-name', 'Invalid file name');
  }
  const full = join(expandTilde(dirPath), name);
  let fd: number;
  try {
    fd = openSync(full, 'wx'); // 'wx' fails if it already exists (atomic create)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new FsBrowserError('exists', 'A file with that name already exists');
    }
    throw err;
  }
  closeSync(fd);
  return full;
}
