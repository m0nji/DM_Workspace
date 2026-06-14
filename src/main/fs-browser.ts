import { readdirSync, statSync, readFileSync, writeFileSync, renameSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expandTilde } from './resolve-cwd';
import type { DirEntry } from '../shared/types';

// 2 MB cap for inline editing — past this we refuse to load into a <textarea>.
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

export type FsBrowserCode = 'binary' | 'too-large' | 'exists' | 'invalid-name';

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
  return buf.toString('utf8');
}

export function writeTextFile(path: string, content: string): void {
  const full = expandTilde(path);
  // Atomic write: temp sibling then rename, so a crash can't leave a half file.
  const tmp = `${full}.dmws-tmp-${randomUUID()}`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, full);
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
