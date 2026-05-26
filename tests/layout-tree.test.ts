import { describe, it, expect } from 'vitest';
import { createIdGenerator } from '../src/shared/ids';
import { makePane, collectPaneIds, splitPane, closePane } from '../src/shared/layout-tree';

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
});
