import { describe, expect, it } from 'vitest';
import { cloneTemplateLayout, remapStringMap } from '../src/shared/template-layout';
import type { LayoutNode } from '../src/shared/types';

describe('cloneTemplateLayout', () => {
  it('clones a split layout with fresh ids and a pane id mapping', () => {
    const layout: LayoutNode = {
      type: 'split',
      id: 's1',
      direction: 'h',
      ratio: 0.4,
      children: [{ type: 'pane', id: 'p1' }, { type: 'pane', id: 'p2' }]
    };
    let pane = 10;
    let split = 20;
    const result = cloneTemplateLayout(layout, () => `p${pane++}`, () => `s${split++}`);

    expect(result.layout).toEqual({
      type: 'split',
      id: 's20',
      direction: 'h',
      ratio: 0.4,
      children: [{ type: 'pane', id: 'p10' }, { type: 'pane', id: 'p11' }]
    });
    expect(result.paneIdMap).toEqual({ p1: 'p10', p2: 'p11' });
  });

  it('clones a single pane layout', () => {
    const result = cloneTemplateLayout({ type: 'pane', id: 'tp1' }, () => 'p99', () => 's99');
    expect(result.layout).toEqual({ type: 'pane', id: 'p99' });
    expect(result.paneIdMap).toEqual({ tp1: 'p99' });
  });
});

describe('remapStringMap', () => {
  it('remaps keys via the pane id mapping and drops empty values', () => {
    const out = remapStringMap({ p1: 'dev server', p2: '   ' }, { p1: 'p10', p2: 'p11' });
    expect(out).toEqual({ p10: 'dev server' });
  });

  it('returns undefined for an undefined source', () => {
    expect(remapStringMap(undefined, { p1: 'p10' })).toBeUndefined();
  });

  it('returns undefined when nothing maps through', () => {
    expect(remapStringMap({ pX: 'orphan' }, { p1: 'p10' })).toBeUndefined();
  });
});
