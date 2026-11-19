import { describe, it, expect } from 'vitest';
import { createIdGenerator } from '../src/shared/ids';
import { makePane, collectPaneIds, splitPane, closePane, setRatio, makePreset, swapPanes, movePane, paneDropZoneAt, dockPaneAtRoot, rootDockSideAt } from '../src/shared/layout-tree';
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

describe('swapPanes', () => {
  // 2x2-Gitter:  tl | tr
  //              ---+---
  //              bl | br
  const grid = (): SplitNode => ({
    type: 'split', id: 's0', direction: 'v', ratio: 0.4,
    children: [
      { type: 'split', id: 's1', direction: 'h', ratio: 0.3, children: [makePane('tl'), makePane('tr')] },
      { type: 'split', id: 's2', direction: 'h', ratio: 0.6, children: [makePane('bl'), makePane('br')] }
    ]
  });

  it('tauscht zwei Panes ueber Split-Grenzen hinweg', () => {
    const result = swapPanes(grid(), 'tl', 'br');
    expect(collectPaneIds(result)).toEqual(['br', 'tr', 'bl', 'tl']);
  });

  it('laesst Split-Ids, Richtungen und Ratios unangetastet', () => {
    const result = swapPanes(grid(), 'tl', 'br') as SplitNode;
    expect(result.id).toBe('s0');
    expect(result.direction).toBe('v');
    expect(result.ratio).toBe(0.4);
    expect((result.children[0] as SplitNode).ratio).toBe(0.3);
    expect((result.children[1] as SplitNode).ratio).toBe(0.6);
  });

  it('tauscht auch Geschwister innerhalb desselben Splits', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(collectPaneIds(swapPanes(tree, 'a', 'b'))).toEqual(['b', 'a']);
  });

  it('ist wirkungslos, wenn beide Ids gleich sind', () => {
    const tree = grid();
    expect(swapPanes(tree, 'tl', 'tl')).toBe(tree);
  });

  it('ist wirkungslos bei einer unbekannten Id', () => {
    const tree = grid();
    expect(swapPanes(tree, 'tl', 'gibtesnicht')).toBe(tree);
    expect(swapPanes(tree, 'gibtesnicht', 'br')).toBe(tree);
  });

  it('gibt unveraenderte Teilbaeume referenzgleich zurueck', () => {
    const tree = grid();
    const result = swapPanes(tree, 'tl', 'tr') as SplitNode;
    // Nur der obere Split aendert sich; der untere bleibt dasselbe Objekt.
    expect(result.children[1]).toBe(tree.children[1]);
  });
});

describe('movePane', () => {
  // Ausgangslage aus dem Fehlerbild: links ein Pane, rechts zwei uebereinander.
  //   l | rt
  //     | --
  //     | rb
  const threeWay = (): SplitNode => ({
    type: 'split', id: 's0', direction: 'h', ratio: 0.5,
    children: [
      makePane('l'),
      { type: 'split', id: 's1', direction: 'v', ratio: 0.5, children: [makePane('rt'), makePane('rb')] }
    ]
  });

  it('legt ein Pane unter ein anderes (rechts oben -> unter links)', () => {
    const result = movePane(threeWay(), 'rt', 'l', 'bottom', 'sN');
    expect(result).toEqual({
      type: 'split', id: 's0', direction: 'h', ratio: 0.5,
      children: [
        { type: 'split', id: 'sN', direction: 'v', ratio: 0.5, children: [makePane('l'), makePane('rt')] },
        makePane('rb')
      ]
    });
  });

  it('dockt links und oben vor dem Ziel an', () => {
    const left = movePane(threeWay(), 'rb', 'l', 'left', 'sN') as SplitNode;
    expect(collectPaneIds(left)).toEqual(['rb', 'l', 'rt']);
    expect((left.children[0] as SplitNode).direction).toBe('h');

    const top = movePane(threeWay(), 'rb', 'l', 'top', 'sN') as SplitNode;
    expect(collectPaneIds(top)).toEqual(['rb', 'l', 'rt']);
    expect((top.children[0] as SplitNode).direction).toBe('v');
  });

  it('laesst den alten Platz dem Geschwister zufallen', () => {
    const result = movePane(threeWay(), 'l', 'rb', 'right', 'sN') as SplitNode;
    // s0 ist weg, der rechte Split rueckt an die Wurzel.
    expect(result.id).toBe('s1');
    expect(result.children[0]).toEqual(makePane('rt'));
    expect(result.children[1]).toEqual({
      type: 'split', id: 'sN', direction: 'h', ratio: 0.5, children: [makePane('rb'), makePane('l')]
    });
  });

  it('dreht zwei Geschwister von nebeneinander auf uebereinander', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(movePane(tree, 'b', 'a', 'bottom', 'sN')).toEqual({
      type: 'split', id: 'sN', direction: 'v', ratio: 0.5, children: [makePane('a'), makePane('b')]
    });
  });

  it('ist wirkungslos, wenn die Quelle schon an dieser Seite liegt', () => {
    const tree = { ...splitPane(makePane('a'), 'a', 'h', 'b', 's1'), ratio: 0.3 } as SplitNode;
    expect(movePane(tree, 'b', 'a', 'right', 'sN')).toBe(tree);
    expect(movePane(tree, 'a', 'b', 'left', 'sN')).toBe(tree);
  });

  it('ist wirkungslos bei gleicher oder unbekannter Id', () => {
    const tree = threeWay();
    expect(movePane(tree, 'l', 'l', 'left', 'sN')).toBe(tree);
    expect(movePane(tree, 'l', 'gibtesnicht', 'left', 'sN')).toBe(tree);
    expect(movePane(tree, 'gibtesnicht', 'l', 'left', 'sN')).toBe(tree);
  });

  it('behaelt alle Panes', () => {
    const result = movePane(threeWay(), 'rt', 'l', 'top', 'sN');
    expect(collectPaneIds(result).sort()).toEqual(['l', 'rb', 'rt']);
  });
});

describe('paneDropZoneAt', () => {
  it('liefert die Mitte im inneren Bereich', () => {
    expect(paneDropZoneAt(0.5, 0.5)).toBe('center');
    expect(paneDropZoneAt(0.3, 0.7)).toBe('center');
  });

  it('liefert den naechsten Rand im aeusseren Viertel', () => {
    expect(paneDropZoneAt(0.1, 0.5)).toBe('left');
    expect(paneDropZoneAt(0.9, 0.5)).toBe('right');
    expect(paneDropZoneAt(0.5, 0.1)).toBe('top');
    expect(paneDropZoneAt(0.5, 0.9)).toBe('bottom');
  });

  it('entscheidet in der Ecke nach dem naeheren Rand', () => {
    expect(paneDropZoneAt(0.05, 0.15)).toBe('left');
    expect(paneDropZoneAt(0.15, 0.95)).toBe('bottom');
  });

  it('klemmt Werte ausserhalb von 0..1', () => {
    expect(paneDropZoneAt(-0.2, 0.5)).toBe('left');
    expect(paneDropZoneAt(0.5, 1.4)).toBe('bottom');
  });
});

describe('dockPaneAtRoot', () => {
  // 2x2-Gitter wie bei swapPanes
  const grid = (): SplitNode => ({
    type: 'split', id: 's0', direction: 'v', ratio: 0.4,
    children: [
      { type: 'split', id: 's1', direction: 'h', ratio: 0.3, children: [makePane('tl'), makePane('tr')] },
      { type: 'split', id: 's2', direction: 'h', ratio: 0.6, children: [makePane('bl'), makePane('br')] }
    ]
  });

  it('setzt ein Pane ueber die volle Breite unten', () => {
    const result = dockPaneAtRoot(grid(), 'tr', 'bottom', 'sN') as SplitNode;
    expect(result.id).toBe('sN');
    expect(result.direction).toBe('v');
    expect(result.children[1]).toEqual(makePane('tr'));
    // Der Rest: oben tl allein (s1 kollabiert), unten weiter bl|br
    expect(collectPaneIds(result.children[0])).toEqual(['tl', 'bl', 'br']);
    expect((result.children[0] as SplitNode).ratio).toBe(0.4);
  });

  it('setzt ein Pane ueber die volle Hoehe links', () => {
    const result = dockPaneAtRoot(grid(), 'br', 'left', 'sN') as SplitNode;
    expect(result.direction).toBe('h');
    expect(result.children[0]).toEqual(makePane('br'));
    expect(collectPaneIds(result.children[1])).toEqual(['tl', 'tr', 'bl']);
  });

  it('ist wirkungslos, wenn das Pane schon so an der Wurzel steht', () => {
    const tree = splitPane(makePane('a'), 'a', 'v', 'b', 's1');
    expect(dockPaneAtRoot(tree, 'b', 'bottom', 'sN')).toBe(tree);
    expect(dockPaneAtRoot(tree, 'a', 'top', 'sN')).toBe(tree);
  });

  it('dreht zwei Panes von nebeneinander auf uebereinander', () => {
    const tree = splitPane(makePane('a'), 'a', 'h', 'b', 's1');
    expect(dockPaneAtRoot(tree, 'a', 'bottom', 'sN')).toEqual({
      type: 'split', id: 'sN', direction: 'v', ratio: 0.5, children: [makePane('b'), makePane('a')]
    });
  });

  it('ist wirkungslos bei einzelnem Pane oder unbekannter Id', () => {
    const lone = makePane('a');
    expect(dockPaneAtRoot(lone, 'a', 'left', 'sN')).toBe(lone);
    const tree = grid();
    expect(dockPaneAtRoot(tree, 'gibtesnicht', 'left', 'sN')).toBe(tree);
  });
});

describe('rootDockSideAt', () => {
  const root = { left: 0, top: 0, right: 1000, bottom: 800 };
  const topLeft = { left: 0, top: 0, right: 500, bottom: 400 };
  const inner = { left: 500, top: 0, right: 1000, bottom: 400 }; // rechts oben

  it('erkennt das Band an einer Layout-Kante, die das Pane beruehrt', () => {
    expect(rootDockSideAt(topLeft, root, 10, 200)).toBe('left');
    expect(rootDockSideAt(topLeft, root, 250, 10)).toBe('top');
  });

  it('bietet keine Kante an, die das Pane nicht beruehrt', () => {
    // untere Kante des Panes liegt mitten im Layout
    expect(rootDockSideAt(topLeft, root, 250, 395)).toBeNull();
    expect(rootDockSideAt(inner, root, 505, 200)).toBeNull();
  });

  it('liefert ausserhalb des Bandes null', () => {
    expect(rootDockSideAt(topLeft, root, 30, 200)).toBeNull();
  });

  it('nimmt in der Ecke die naehere Kante', () => {
    expect(rootDockSideAt(topLeft, root, 5, 15)).toBe('left');
    expect(rootDockSideAt(topLeft, root, 15, 5)).toBe('top');
  });

  it('toleriert Rundungsabweichungen von bis zu 2 px', () => {
    expect(rootDockSideAt({ ...inner, right: 998.5 }, root, 990, 200)).toBe('right');
  });
});
