import { homedir } from 'node:os';
import { isAbsolute, parse, resolve } from 'node:path';
import { isUncPath } from '../shared/link-detect';
import { expandTilde } from './resolve-cwd';

// Grenze für jeden Pfad, den der Renderer an einen fs:*-Kanal schickt. Die
// Kanäle akzeptieren bewusst beliebige Pfade (Datei-Panel), aber nicht beliebige
// *Werte*: expandTilde('') ist das Home-Verzeichnis, und ein UNC-Pfad lässt
// Windows sich per SMB verbinden und den NTLM-Hash senden.

export class FsGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FsGuardError';
  }
}

const samePath = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

export function assertFsPath(raw: unknown): string {
  if (typeof raw !== 'string') throw new FsGuardError('path must be a string');
  if (raw.includes('\0')) throw new FsGuardError('path contains a NUL byte');
  const expanded = expandTilde(raw);
  if (isUncPath(expanded)) throw new FsGuardError('UNC paths are not allowed');
  return expanded;
}

export function assertDeletablePath(raw: unknown): string {
  const expanded = assertFsPath(raw);
  if ((raw as string).trim() === '') throw new FsGuardError('empty path');
  if (!isAbsolute(expanded)) throw new FsGuardError('path must be absolute');
  const abs = resolve(expanded);
  if (samePath(abs, resolve(homedir())) || samePath(abs, parse(abs).root)) {
    throw new FsGuardError('refusing to delete the home directory or the filesystem root');
  }
  return expanded;
}
