// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beginDragGuard } from '../src/renderer/drag-guard';

describe('beginDragGuard', () => {
  it('marks the body while a drag is active and clears it on end', () => {
    const end = beginDragGuard();
    expect(document.body.classList.contains('drag-active')).toBe(true);
    end();
    expect(document.body.classList.contains('drag-active')).toBe(false);
  });

  it('is idempotent on double cleanup', () => {
    const end = beginDragGuard();
    end();
    end();
    expect(document.body.classList.contains('drag-active')).toBe(false);
  });

  // The class only helps if the stylesheet actually switches the preview
  // <webview> off during drags — its out-of-process guest otherwise swallows
  // mousemove/mouseup and the splitter drag never ends.
  it('styles.css disables pointer events on webviews during a drag', () => {
    const css = readFileSync(join(__dirname, '../src/renderer/styles.css'), 'utf8');
    expect(css).toMatch(/body\.drag-active\s+webview\s*\{[^}]*pointer-events:\s*none/);
  });
});
