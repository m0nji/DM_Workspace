import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../src/renderer/styles.css'), 'utf8');
const accentValues = ['var(--accent)', 'var(--dm-accent-orange)', '#c97b4a', '#ee9a5d'];

function ruleBodies(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = styles.matchAll(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`, 'gm'));
  return Array.from(matches, (match) => match[1]);
}

describe('DM brand styles', () => {
  it('declares the DM BrandDesign token layer', () => {
    expect(styles).toContain('--dm-surface-app: #0d0d0d;');
    expect(styles).toContain('--dm-surface-panel: #1a1a1a;');
    expect(styles).toContain('--dm-surface-panel-elevated: #2c2c2e;');
    expect(styles).toContain('--dm-border-default: #333333;');
    expect(styles).toContain('--dm-text-primary: #dddddd;');
    expect(styles).toContain('--dm-text-muted: #888888;');
    expect(styles).toContain('--dm-accent-orange: #c97b4a;');
    expect(styles).toContain('--dm-accent-orange-hover: #ee9a5d;');
    expect(styles).toContain('--dm-accent-orange-soft: rgba(201, 123, 74, 0.14);');
  });

  it('keeps titlebar icon buttons neutral on hover and when active', () => {
    const hoverRules = ruleBodies('.icon-btn:hover');
    expect(hoverRules).toHaveLength(1);
    const hoverRule = hoverRules[0];

    expect(hoverRule).toContain('background: var(--chrome-action-hover-bg);');
    expect(hoverRule).toContain('color: var(--text);');
    accentValues.forEach((value) => expect(hoverRule).not.toContain(value));

    const activeRules = ruleBodies('.icon-btn.active');
    expect(activeRules).toHaveLength(1);
    const activeRule = activeRules[0];

    expect(activeRule).toContain('background: var(--chrome-action-active-bg);');
    expect(activeRule).toContain('color: var(--text);');
    accentValues.forEach((value) => expect(activeRule).not.toContain(value));
  });

  it('keeps active workspace rows active while hovered', () => {
    const activeHoverRules = ruleBodies('.ws-item.active:hover');

    expect(activeHoverRules).toHaveLength(1);
    expect(activeHoverRules[0]).toContain('background: var(--accent-soft);');
    expect(activeHoverRules[0]).toContain('color: var(--text-strong);');
  });

  it('guards disabled button hover states', () => {
    expect(ruleBodies('.confirm-btn:hover')).toHaveLength(0);
    expect(ruleBodies('.confirm-btn-danger:hover')).toHaveLength(0);
    expect(ruleBodies('.cwd-btn:hover')).toHaveLength(0);

    expect(ruleBodies('.confirm-btn:hover:not(:disabled)')).toHaveLength(1);
    expect(ruleBodies('.confirm-btn-danger:hover:not(:disabled)')).toHaveLength(1);
    expect(ruleBodies('.cwd-btn:hover:not(:disabled)')).toHaveLength(1);
  });
});
