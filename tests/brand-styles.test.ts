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
  it('declares the DM BrandDesign token layer with both design families', () => {
    // Standard Utility on :root.
    expect(styles).toContain('--dm-surface-app: #1f1f1f;');
    expect(styles).toContain('--dm-surface-panel: #212121;');
    expect(styles).toContain('--dm-surface-panel-elevated: #2f2f32;');
    expect(styles).toContain('--dm-border-default: #343438;');
    expect(styles).toContain('--dm-text-primary: #dedee2;');
    expect(styles).toContain('--dm-text-muted: #9a9aa2;');
    expect(styles).toContain('--dm-accent-orange: #c97b4a;');
    expect(styles).toContain('--dm-accent-orange-hover: #ee9a5d;');
    expect(styles).toContain('--dm-accent-orange-soft: rgba(201, 123, 74, 0.14);');
    expect(styles).toContain('--dm-on-accent: #1a120b;');

    // Black Utility override family.
    expect(styles).toContain('.root[data-brand-design="black"]');
    const blackRules = ruleBodies('.root[data-brand-design="black"]');
    expect(blackRules).toHaveLength(1);
    expect(blackRules[0]).toContain('--dm-surface-app: #000000;');
    expect(blackRules[0]).toContain('--dm-surface-panel: #060606;');
    expect(blackRules[0]).toContain('--dm-border-default: #222226;');
    expect(blackRules[0]).toContain('--dm-text-primary: #e6e6ea;');

    // The compatibility aliases must be re-declared inside the black scope:
    // aliases computed on :root bake in the Standard values, so without these
    // re-declarations the black design would only affect direct --dm-* users.
    for (const alias of [
      '--bg: var(--dm-surface-app);',
      '--panel: var(--dm-surface-panel);',
      '--panel-elevated: var(--dm-surface-panel-elevated);',
      '--input: var(--dm-surface-input);',
      '--border: var(--dm-border-default);',
      '--border-strong: var(--dm-border-strong);',
      '--border-hover: var(--dm-border-hover);',
      '--text: var(--dm-text-primary);',
      '--muted: var(--dm-text-muted);',
      '--accent-soft: var(--dm-accent-orange-soft);'
    ]) {
      expect(blackRules[0]).toContain(alias);
    }
  });

  it('declares the Graphite Sand corporate family with re-declared aliases', () => {
    const graphiteRules = ruleBodies('.root[data-brand-design="graphite"]');
    expect(graphiteRules).toHaveLength(1);
    const rule = graphiteRules[0];

    // Core Graphite Sand tokens (DM_CICD dm-apps-brand-tokens.css).
    expect(rule).toContain('--dm-surface-app: #090908;');
    expect(rule).toContain('--dm-surface-panel-elevated: #23201d;');
    expect(rule).toContain('--dm-border-default: #342f2a;');
    expect(rule).toContain('--dm-text-strong: #f5f1ea;');
    expect(rule).toContain('--dm-text-muted: #a9a39a;');
    expect(rule).toContain('--dm-accent-orange: #c7b299;');
    expect(rule).toContain('--dm-accent-orange-hover: #e7d7bf;');
    expect(rule).toContain('--dm-on-accent: #171512;');
    expect(rule).toContain('--dm-gradient-bg:');

    // Alias re-declarations, INCLUDING the accent aliases (the family swaps the
    // accent from utility orange to brand sand — see the note on the black family).
    for (const alias of [
      '--bg: var(--dm-surface-app);',
      '--panel: var(--dm-surface-panel);',
      '--border: var(--dm-border-default);',
      '--text: var(--dm-text-primary);',
      '--muted: var(--dm-text-muted);',
      '--accent: var(--dm-accent-orange);',
      '--accent-hover: var(--dm-accent-orange-hover);',
      '--accent-active: var(--dm-accent-orange-active);',
      '--accent-soft: var(--dm-accent-orange-soft);',
      '--on-accent: var(--dm-on-accent);'
    ]) {
      expect(rule).toContain(alias);
    }
  });

  it('applies the brand gradient backdrop to the settings modal and welcome screen in graphite', () => {
    expect(styles).toContain('.root[data-brand-design="graphite"] .modal.settings-modal { background: var(--dm-gradient-bg); }');
    expect(styles).toContain('.root[data-brand-design="graphite"] .welcome { background: var(--dm-gradient-bg); }');
  });

  it('keeps accent-derived fills family-aware instead of hardcoding utility orange', () => {
    // These once hardcoded rgba(201, 123, 74, …) and would have stayed orange
    // under the Graphite Sand family.
    expect(ruleBodies('.update-badge.downloading')[0]).toContain('color-mix(in srgb, var(--accent) 16%, transparent)');
    expect(ruleBodies('.ftree-row.sel')[0]).toContain('color-mix(in srgb, var(--accent) 22%, transparent)');
  });

  it('uses ink text on filled accent controls instead of white', () => {
    for (const selector of ['.btn-primary', '.confirm-btn.primary', '.update-badge', '.segmented-control-item.active']) {
      const rules = ruleBodies(selector);
      expect(rules.length).toBeGreaterThan(0);
      expect(rules[0]).toContain('color: var(--on-accent);');
    }
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
