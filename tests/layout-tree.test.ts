import { describe, it, expect } from 'vitest';
import { createIdGenerator } from '../src/shared/ids';
import { makePane, collectPaneIds, collectSplitIds, splitPane, closePane, setRatio, makePreset } from '../src/shared/layout-tree';
import type { SplitNode } from '../src/shared/types';

describe('createIdGenerator', () => {
  it('produces unique sequential ids with a prefix', () => {
    const next = createIdGenerator('p');
    expect(next()).toBe('p1');
    expect(next()).toBe('p2');
    expect(next()).toBe('p3');
  });
});

describe('makePane / collectPaneIds', () => {
  it('makePane creates a pane node', () => {
    expect(makePane('a')).toEqual({ type: 'pane', id: 'a' });
  });

  it('collectPaneIds returns single id for a lone pane', () => {
    expect(collectPaneIds(makePane('a'))).toEqual(['a']);
  });

  it('collectPaneIds returns [] for null layout', () => {
    expect(collectPaneIds(null)).toEqual([]);
  });
});

describe('splitPane', () => {
  it('replaces target pane with a split of [old, new]', () => {
    const tree = makePane('a');
    const result = splitPane(tree, 'a', 'h', 'b', 's1');
    expect(result).toEqual({
      type: 'split', id: 's1', direction: 'h', ratio: 0.5,
      children: [{ type: 'pane', id: 'a' }, { type: 'pane', id: 'b' }]
    });
  });

  it('splits a nested pane and leaves siblings untouched', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    const result = splitPane(tree, 'b', 'v', 'c', 's2');
    expect(collectPaneIds(result)).toEqual(['a', 'b', 'c']);
    const right = (result as any).children[1];
    expect(right).toEqual({
      type: 'split', id: 's2', direction: 'v', ratio: 0.5,
      children: [{ type: 'pane', id: 'b' }, { type: 'pane', id: 'c' }]
    });
  });

  it('returns the tree unchanged when target pane not found', () => {
    const tree = makePane('a');
    expect(splitPane(tree, 'zzz', 'h', 'b', 's1')).toEqual(tree);
  });

  it('clamps ratio to 0.9 when ratio > 0.9', () => {
    const result = splitPane(makePane('a'), 'a', 'h', 'b', 's1', 5) as any;
    expect(result.ratio).toBe(0.9);
  });

  it('clamps ratio to 0.1 when ratio < 0.1', () => {
    const result = splitPane(makePane('a'), 'a', 'h', 'b', 's1', 0) as any;
    expect(result.ratio).toBe(0.1);
  });

  it('shares untouched subtrees by reference (like closePane)', () => {
    let tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1') as SplitNode;
    tree = splitPane(tree, 'a', 'v', 'c', 's2') as SplitNode;
    const untouchedRight = tree.children[1]; // pane 'b'
    const result = splitPane(tree, 'c', 'h', 'd', 's3') as SplitNode;
    expect(result.children[1]).toBe(untouchedRight);
    // No target at all -> the whole tree comes back by reference.
    expect(splitPane(tree, 'zzz', 'h', 'x', 'sx')).toBe(tree);
  });
});

describe('closePane', () => {
  it('returns null when the only pane is closed', () => {
    expect(closePane(makePane('a'), 'a')).toBeNull();
  });

  it('collapses parent split so sibling takes the space', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(closePane(tree, 'b')).toEqual({ type: 'pane', id: 'a' });
    expect(closePane(tree, 'a')).toEqual({ type: 'pane', id: 'b' });
  });

  it('collapses correctly in a nested tree', () => {
    let tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    tree = splitPane(tree, 'b', 'v', 'c', 's2');
    const result = closePane(tree, 'c');
    expect(collectPaneIds(result!)).toEqual(['a', 'b']);
    expect((result as any).children[1]).toEqual({ type: 'pane', id: 'b' });
  });

  it('returns tree unchanged when pane not found', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(closePane(tree, 'zzz')).toEqual(tree);
  });

  it('returns the same reference when pane not found (no reallocation)', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(closePane(tree, 'zzz')).toBe(tree);
  });
});

describe('setRatio', () => {
  it('updates ratio of the matching split', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    const result = setRatio(tree, 's1', 0.3);
    expect((result as any).ratio).toBe(0.3);
  });

  it('shares untouched subtrees by reference (like closePane)', () => {
    let tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1') as SplitNode;
    tree = splitPane(tree, 'a', 'v', 'c', 's2') as SplitNode;
    const untouchedRight = tree.children[1]; // pane 'b'
    const result = setRatio(tree, 's2', 0.7) as SplitNode;
    expect(result.children[1]).toBe(untouchedRight);
    // Unknown split id -> the whole tree comes back by reference.
    expect(setRatio(tree, 'nope', 0.7)).toBe(tree);
  });

  it('clamps ratio into [0.1, 0.9]', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect((setRatio(tree, 's1', 0) as any).ratio).toBe(0.1);
    expect((setRatio(tree, 's1', 1) as any).ratio).toBe(0.9);
  });

  it('updates a nested split without touching others', () => {
    let tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    tree = splitPane(tree, 'b', 'v', 'c', 's2');
    const result = setRatio(tree, 's2', 0.7);
    expect((result as any).ratio).toBe(0.5);
    expect((result as any).children[1].ratio).toBe(0.7);
  });
});

describe('makePreset', () => {
  it('1 => single pane', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    const tree = makePreset('1', next, next);
    expect(tree.type).toBe('pane');
    expect(collectPaneIds(tree)).toHaveLength(1);
  });

  it('2h => one horizontal split, two panes', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    const tree = makePreset('2h', next, next);
    expect(tree.type).toBe('split');
    expect((tree as any).direction).toBe('h');
    expect(collectPaneIds(tree)).toHaveLength(2);
  });

  it('2v => vertical split', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    expect((makePreset('2v', next, next) as any).direction).toBe('v');
  });

  it('4 => 2x2 with outer vertical split and horizontal rows', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    const tree = makePreset('4', next, next) as any;
    expect(collectPaneIds(tree)).toHaveLength(4);
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('v');
    expect(tree.children[0].direction).toBe('h');
    expect(tree.children[1].direction).toBe('h');
  });

  it('8 => 2x4 with outer vertical split, children are horizontal rows of 4', () => {
    const next = (() => { let n = 0; return () => `id${++n}`; })();
    const tree = makePreset('8', next, next) as any;
    expect(collectPaneIds(tree)).toHaveLength(8);
    expect(tree.type).toBe('split');
    expect(tree.direction).toBe('v');
    expect(tree.children[0].direction).toBe('h');
    expect(tree.children[1].direction).toBe('h');
    expect(tree.children[0].children[0].direction).toBe('h');
    expect(tree.children[0].children[1].direction).toBe('h');
    expect(tree.children[1].children[0].direction).toBe('h');
    expect(tree.children[1].children[1].direction).toBe('h');
  });
});
