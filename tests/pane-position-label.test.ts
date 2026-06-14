import { describe, it, expect } from 'vitest';
import { panePositionTokens } from '../src/shared/layout-tree';
import type { LayoutNode } from '../src/shared/types';

const pane = (id: string): LayoutNode => ({ type: 'pane', id });
const split = (id: string, direction: 'h' | 'v', a: LayoutNode, b: LayoutNode): LayoutNode =>
  ({ type: 'split', id, direction, ratio: 0.5, children: [a, b] });

describe('panePositionTokens', () => {
  it('returns empty for a single pane (nothing to disambiguate)', () => {
    expect(panePositionTokens(pane('p1'), 'p1')).toEqual([]);
  });

  it('labels a vertical split as top/bottom', () => {
    const layout = split('s1', 'v', pane('p1'), pane('p2'));
    expect(panePositionTokens(layout, 'p1')).toEqual(['top']);
    expect(panePositionTokens(layout, 'p2')).toEqual(['bottom']);
  });

  it('labels a horizontal split as left/right', () => {
    const layout = split('s1', 'h', pane('p1'), pane('p2'));
    expect(panePositionTokens(layout, 'p1')).toEqual(['left']);
    expect(panePositionTokens(layout, 'p2')).toEqual(['right']);
  });

  it('labels a 2x2 grid with vertical token first', () => {
    const top = split('s2', 'h', pane('p1'), pane('p2'));
    const bottom = split('s3', 'h', pane('p3'), pane('p4'));
    const layout = split('s1', 'v', top, bottom);
    expect(panePositionTokens(layout, 'p1')).toEqual(['top', 'left']);
    expect(panePositionTokens(layout, 'p2')).toEqual(['top', 'right']);
    expect(panePositionTokens(layout, 'p3')).toEqual(['bottom', 'left']);
    expect(panePositionTokens(layout, 'p4')).toEqual(['bottom', 'right']);
  });

  it('returns empty when the pane is not found', () => {
    const layout = split('s1', 'v', pane('p1'), pane('p2'));
    expect(panePositionTokens(layout, 'nope')).toEqual([]);
  });

  it('returns empty for a null layout', () => {
    expect(panePositionTokens(null, 'p1')).toEqual([]);
  });
});
