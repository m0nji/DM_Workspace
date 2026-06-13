import { readFileSync, statSync } from 'node:fs';

export const MAX_PREVIEW_BYTES = 1024 * 1024;

export function isPreviewReadablePath(path: string): boolean {
  return /\.(md|markdown|mdx|txt)$/i.test(path);
}

export function readPreviewFile(path: string): string {
  if (!isPreviewReadablePath(path)) {
    throw new Error('file:read is restricted to text/markdown files');
  }
  const stat = statSync(path);
  if (stat.size > MAX_PREVIEW_BYTES) {
    throw new Error(`Preview file is too large (${stat.size} bytes)`);
  }
  return readFileSync(path, 'utf8');
}
