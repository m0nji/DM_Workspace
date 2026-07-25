import { readFileSync, statSync } from 'node:fs';
import { isUncPath } from '../shared/link-detect';

export const MAX_PREVIEW_BYTES = 1024 * 1024;

export function isPreviewReadablePath(path: string): boolean {
  return /\.(md|markdown|mdx|txt)$/i.test(path);
}

export function readPreviewFile(path: string): string {
  // Paths originate in untrusted terminal output. A UNC path would make Windows
  // fetch the file over SMB from the named host, handing it the user's NTLM
  // hash — so it is refused here too, not only in the renderer that built it.
  if (isUncPath(path)) {
    throw new Error('file:read is restricted to local paths');
  }
  if (!isPreviewReadablePath(path)) {
    throw new Error('file:read is restricted to text/markdown files');
  }
  const stat = statSync(path);
  if (stat.size > MAX_PREVIEW_BYTES) {
    throw new Error(`Preview file is too large (${stat.size} bytes)`);
  }
  return readFileSync(path, 'utf8');
}
