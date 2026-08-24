import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(resolve(__dirname, '../src/renderer/styles.css'), 'utf8');
const navigation = readFileSync(resolve(__dirname, '../src/renderer/components/WorkspaceNavigation.tsx'), 'utf8');
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
    // Deepened sand accent: filled buttons read washed-out at #c7b299, so the
    // base sits one step darker and the old base became the hover.
    expect(rule).toContain('--dm-accent-orange: #b89a73;');
    expect(rule).toContain('--dm-accent-orange-hover: #c7b299;');
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
    expect(styles).toContain('.root[data-brand-design="graphite"] .modal.confirm-modal { background: var(--dm-gradient-bg); }');
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

  it('marks a register group with a rail only, never a second filled surface', () => {
    // Grouped surface: the group is marked exactly ONCE, and that one marker is
    // already the bar itself (.sidebar / .workspace-tabs carry the --panel fill).
    // A filled box inside it would draw the same edge a second time.
    // ruleBodies matches the selector as a substring, so this one query already
    // covers the bare rule and both placement-scoped ones.
    const container = ruleBodies('.ws-group');
    expect(container.length).toBeGreaterThan(0);
    container.forEach((rule) => {
      expect(rule).not.toMatch(/(^|;|\s)background(-color)?\s*:/);
      expect(rule).not.toMatch(/(^|;|\s)border\s*:/);
    });

    // The rail exists on both axes and takes the group's colour.
    const rail = ruleBodies('.ws-group::before');
    expect(rail.length).toBeGreaterThan(0);
    // Exactly one of them paints; the placement-scoped rules only place it.
    expect(rail.filter((r) => r.includes('background: var(--ws-group-color, var(--accent));'))).toHaveLength(1);
    expect(ruleBodies('.sidebar .ws-group::before')).toHaveLength(1);
    expect(ruleBodies('.workspace-tabs .ws-group::before')).toHaveLength(1);
  });

  it('presents a group as a typographic section heading without a duplicate colour dot', () => {
    expect(navigation).not.toContain('ws-group-dot');
    expect(navigation).toContain('ws-group-disclosure');

    const chip = ruleBodies('.ws-group-chip').find((rule) => rule.includes('display: flex'));
    const name = ruleBodies('.ws-group-chip .ws-group-name').find((rule) => rule.includes('letter-spacing'));
    const count = ruleBodies('.ws-group-chip .ws-group-count')[0];
    expect(chip).toContain('font-size: 12px');
    expect(chip).toContain('font-weight: 600');
    expect(name).toContain('flex: 1 1 auto');
    expect(count).toContain('font-size: 10px');
    expect(count).toContain('border-radius: 999px');
  });

  it('rings the grouping drop target inwards, so a scrolling bar cannot clip it', () => {
    const into = ruleBodies('.ws-item.drop-into, .workspace-tab.drop-into, .ws-group-chip.drop-into');

    expect(into).toHaveLength(1);
    expect(into[0]).toContain('inset 0 0 0 2px var(--accent)');
  });

  it('keeps the drop hint out of the drag stream', () => {
    const hint = ruleBodies('.ws-drop-hint');

    expect(hint).toHaveLength(1);
    // Without this the hint's own nodes swallow dragleave/drop under the pointer.
    expect(hint[0]).toContain('pointer-events: none;');
    // Portalled to body, so it must not scroll with the bar it describes.
    expect(hint[0]).toContain('position: fixed;');
  });

  it('marks a running register without resizing it', () => {
    // outline, not border: a border would change the dot's box and make the row
    // jump every time a command starts or ends. The offset is what makes it read
    // as a ring rather than as a slightly fatter dot.
    // The rule lists both dots; ruleBodies matches on the selector text right
    // before the brace, so query the last one in the group. Two rules carry it:
    // the base one and its reduced-motion counterpart.
    const rules = ruleBodies('[data-busy] .ws-remote-icon.running');
    expect(rules).toHaveLength(2);
    rules.forEach((rule) => {
      expect(rule).toContain('outline: 2px solid var(--busy-color, var(--accent));');
      expect(rule).toContain('outline-offset: 2px;');
      expect(rule).not.toMatch(/(^|;|\s)border\s*:/);
    });
    // The quiet ring is the base rule, and nothing about it moves.
    expect(rules[0]).not.toContain('animation:');

    const groupRules = ruleBodies('[data-busy] .ws-group-chip.running');
    expect(groupRules).toHaveLength(2);
    groupRules.forEach((rule) => {
      expect(rule).toContain('outline: 1px solid var(--busy-color, var(--accent));');
    });
  });

  it('offers every busy variant the settings can select', () => {
    for (const variant of ['pulse', 'blink', 'spin']) {
      expect(styles, `variant ${variant} has no rule`).toContain(`[data-busy="${variant}"] .dot.running`);
    }
    // The quiet ring is deliberately the base rule with nothing animating it.
    expect(styles).not.toContain('[data-busy="ring"]');
    for (const frames of ['dmws-busy-pulse', 'dmws-busy-blink', 'dmws-busy-spin']) {
      expect(styles, `keyframes ${frames} missing`).toContain(`@keyframes ${frames}`);
    }
    expect(styles).toContain('@keyframes dmws-busy-group-scan');
    // Speed and colour come from the settings, never hard-coded.
    expect(styles).toContain('var(--busy-speed, 1200ms)');
  });

  it('hands a ready workspace badge off without tinting the whole pane header', () => {
    const donePane = ruleBodies('.pane.status-done:not(.drag-source):not(.drop-target)');
    const doneHeader = ruleBodies('.pane.status-done .pane-header');
    const doneDot = ruleBodies('.status-dot.done');

    expect(donePane).toHaveLength(1);
    expect(donePane[0]).toContain('inset 0 0 0 1px');
    expect(donePane[0]).toContain('var(--success)');
    expect(doneHeader).toHaveLength(0);
    expect(doneDot).toHaveLength(1);
    expect(doneDot[0]).toContain('box-shadow: 0 0 0 2px');
    expect(donePane[0]).not.toContain('animation:');
    // Pane drag feedback has priority over the ready edge while rearranging.
    expect(styles).not.toContain('.pane.status-done {');
  });

  it('falls back to the quiet ring when the user asked for less motion', () => {
    const reduced = styles.slice(styles.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('animation: none;');
    // The indicator itself must survive — only its motion goes.
    expect(reduced).toContain('outline: 2px solid var(--busy-color, var(--accent));');
  });

  it('guards disabled button hover states', () => {
    expect(ruleBodies('.confirm-btn:hover')).toHaveLength(0);
    expect(ruleBodies('.confirm-btn-danger:hover')).toHaveLength(0);
    expect(ruleBodies('.cwd-btn:hover')).toHaveLength(0);

    expect(ruleBodies('.confirm-btn:hover:not(:disabled)')).toHaveLength(1);
    // Base rule + the graphite-scoped terracotta override — both guarded.
    expect(ruleBodies('.confirm-btn-danger:hover:not(:disabled)')).toHaveLength(2);
    expect(ruleBodies('.cwd-btn:hover:not(:disabled)')).toHaveLength(1);
  });
});
