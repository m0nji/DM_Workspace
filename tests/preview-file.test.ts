import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readPreviewFile, MAX_PREVIEW_BYTES } from '../src/main/preview-file';
import { escapeHtml } from '../src/shared/html';

describe('readPreviewFile', () => {
  it('rejects unsupported extensions before reading', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-preview-'));
    const file = join(dir, 'secret.json');
    writeFileSync(file, '{"secret":true}', 'utf8');

    expect(() => readPreviewFile(file)).toThrow('restricted to text/markdown files');

    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects preview files over the byte cap', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-preview-'));
    const file = join(dir, 'huge.md');
    writeFileSync(file, 'x'.repeat(MAX_PREVIEW_BYTES + 1), 'utf8');

    expect(() => readPreviewFile(file)).toThrow('too large');

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('escapeHtml', () => {
  it('escapes HTML-significant characters from error text', () => {
    expect(escapeHtml('bad <img src=x onerror=alert(1)> & "quote"'))
      .toBe('bad &lt;img src=x onerror=alert(1)&gt; &amp; &quot;quote&quot;');
  });
});
