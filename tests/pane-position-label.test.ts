import { describe, it, expect } from 'vitest';
import { panePositionLabel } from '../src/shared/layout-tree';
import type { LayoutNode } from '../src/shared/types';

const pane = (id: string): LayoutNode => ({ type: 'pane', id });
const split = (id: string, direction: 'h' | 'v', a: LayoutNode, b: LayoutNode): LayoutNode =>
  ({ type: 'split', id, direction, ratio: 0.5, children: [a, b] });

describe('panePositionLabel', () => {
  it('returns empty for a single pane (nothing to disambiguate)', () => {
    expect(panePositionLabel(pane('p1'), 'p1')).toBe('');
  });

  it('labels a vertical split as oben/unten', () => {
    const layout = split('s1', 'v', pane('p1'), pane('p2'));
    expect(panePositionLabel(layout, 'p1')).toBe('oben');
    expect(panePositionLabel(layout, 'p2')).toBe('unten');
  });

  it('labels a horizontal split as links/rechts', () => {
    const layout = split('s1', 'h', pane('p1'), pane('p2'));
    expect(panePositionLabel(layout, 'p1')).toBe('links');
    expect(panePositionLabel(layout, 'p2')).toBe('rechts');
  });

  it('labels a 2x2 grid with vertical word first', () => {
    const top = split('s2', 'h', pane('p1'), pane('p2'));
    const bottom = split('s3', 'h', pane('p3'), pane('p4'));
    const layout = split('s1', 'v', top, bottom);
    expect(panePositionLabel(layout, 'p1')).toBe('oben links');
    expect(panePositionLabel(layout, 'p2')).toBe('oben rechts');
    expect(panePositionLabel(layout, 'p3')).toBe('unten links');
    expect(panePositionLabel(layout, 'p4')).toBe('unten rechts');
  });

  it('returns empty when the pane is not found', () => {
    const layout = split('s1', 'v', pane('p1'), pane('p2'));
    expect(panePositionLabel(layout, 'nope')).toBe('');
  });

  it('returns empty for a null layout', () => {
    expect(panePositionLabel(null, 'p1')).toBe('');
  });
});
