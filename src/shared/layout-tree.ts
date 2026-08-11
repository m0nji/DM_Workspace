import type { LayoutNode, PaneNode, SplitNode, Direction, PresetKind } from './types';

export function makePane(id: string): PaneNode {
  return { type: 'pane', id };
}

function clampRatio(r: number): number { return Math.min(0.9, Math.max(0.1, r)); }

// Returns pane ids in left-to-right depth-first order.
export function collectPaneIds(node: LayoutNode | null): string[] {
  if (node === null) return [];
  if (node.type === 'pane') return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}

// Neutral side tokens describing a pane's position ("top", "bottom left", …)
// derived from its path in the split tree. Vertical splits ('v') read as
// top/bottom, horizontal ('h') as left/right; vertical tokens come first.
// Returns [] for a single pane, an unknown pane, or a null layout — callers
// translate the tokens (see i18n key `pane.pos.*`) and fall back to their own
// default when the array is empty.
export function panePositionTokens(
  node: LayoutNode | null,
  paneId: string
): Array<'top' | 'bottom' | 'left' | 'right'> {
  const path = pathToPane(node, paneId);
  if (!path) return [];
  const vertical: Array<'top' | 'bottom'> = [];
  const horizontal: Array<'left' | 'right'> = [];
  for (const { direction, side } of path) {
    if (direction === 'v') vertical.push(side === 0 ? 'top' : 'bottom');
    else horizontal.push(side === 0 ? 'left' : 'right');
  }
  return [...vertical, ...horizontal];
}

// The sequence of split decisions from the root down to `paneId`, or null if the
// pane isn't in the tree. Each step records the split's direction and which child
// (0/1) the pane lives in.
function pathToPane(
  node: LayoutNode | null,
  paneId: string
): Array<{ direction: Direction; side: 0 | 1 }> | null {
  if (node === null) return null;
  if (node.type === 'pane') return node.id === paneId ? [] : null;
  const left = pathToPane(node.children[0], paneId);
  if (left) return [{ direction: node.direction, side: 0 }, ...left];
  const right = pathToPane(node.children[1], paneId);
  if (right) return [{ direction: node.direction, side: 1 }, ...right];
  return null;
}

// Returns split-node ids in depth-first order.
export function collectSplitIds(node: LayoutNode | null): string[] {
  if (node === null || node.type === 'pane') return [];
  return [node.id, ...collectSplitIds(node.children[0]), ...collectSplitIds(node.children[1])];
}

export function splitPane(
  node: LayoutNode,
  targetPaneId: string,
  direction: Direction,
  newPaneId: string,
  newSplitId: string,
  ratio = 0.5
): LayoutNode {
  if (node.type === 'pane') {
    if (node.id !== targetPaneId) return node;
    return {
      type: 'split',
      id: newSplitId,
      direction,
      ratio: clampRatio(ratio),
      children: [node, makePane(newPaneId)]
    };
  }
  const a = splitPane(node.children[0], targetPaneId, direction, newPaneId, newSplitId, ratio);
  const b = splitPane(node.children[1], targetPaneId, direction, newPaneId, newSplitId, ratio);
  if (a === node.children[0] && b === node.children[1]) return node; // unchanged subtree
  return { ...node, children: [a, b] };
}

export function closePane(node: LayoutNode, targetPaneId: string): LayoutNode | null {
  if (node.type === 'pane') {
    return node.id === targetPaneId ? null : node;
  }
  const a = closePane(node.children[0], targetPaneId);
  const b = closePane(node.children[1], targetPaneId);
  if (a === null && b === null) return null; // defensive: unreachable while pane ids are unique
  if (a === null) return b;
  if (b === null) return a;
  if (a === node.children[0] && b === node.children[1]) return node; // unchanged
  return { ...node, children: [a, b] };
}

export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node;
  if (node.id === splitId) {
    return { ...node, ratio: clampRatio(ratio) };
  }
  const a = setRatio(node.children[0], splitId, ratio);
  const b = setRatio(node.children[1], splitId, ratio);
  if (a === node.children[0] && b === node.children[1]) return node; // unchanged subtree
  return { ...node, children: [a, b] };
}

/**
 * Exchange the positions of two panes. Split ids, directions and ratios stay
 * untouched — only the two `PaneNode`s trade places.
 *
 * What travels is the pane ID, and everything keyed by it comes along: the
 * terminal (pane-host.ts holds one stable container per id and MOVES it rather
 * than remounting), the title, the cwd. So this reorders the layout without
 * restarting a single shell.
 */
export function swapPanes(node: LayoutNode, aId: string, bId: string): LayoutNode {
  if (aId === bId) return node;
  const ids = collectPaneIds(node);
  if (!ids.includes(aId) || !ids.includes(bId)) return node;

  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'pane') {
      if (n.id === aId) return makePane(bId);
      if (n.id === bId) return makePane(aId);
      return n;
    }
    const a = walk(n.children[0]);
    const b = walk(n.children[1]);
    if (a === n.children[0] && b === n.children[1]) return n; // unchanged subtree
    return { ...n, children: [a, b] };
  };
  return walk(node);
}

function split(id: string, direction: Direction, a: LayoutNode, b: LayoutNode): SplitNode {
  return { type: 'split', id, direction, ratio: 0.5, children: [a, b] };
}

/** Build a row of `n` panes (must be a power of two) arranged left/right. */
function row(n: number, nextPaneId: () => string, nextSplitId: () => string): LayoutNode {
  if (n === 1) return makePane(nextPaneId());
  const half = n / 2;
  const left = row(half, nextPaneId, nextSplitId);
  const right = row(half, nextPaneId, nextSplitId);
  return split(nextSplitId(), 'h', left, right);
}

export function makePreset(
  kind: PresetKind,
  nextPaneId: () => string,
  nextSplitId: () => string
): LayoutNode {
  switch (kind) {
    case '1':
      return makePane(nextPaneId());
    case '2h':
      return split(nextSplitId(), 'h', makePane(nextPaneId()), makePane(nextPaneId()));
    case '2v':
      return split(nextSplitId(), 'v', makePane(nextPaneId()), makePane(nextPaneId()));
    case '4': {
      const top = row(2, nextPaneId, nextSplitId);
      const bottom = row(2, nextPaneId, nextSplitId);
      return split(nextSplitId(), 'v', top, bottom);
    }
    case '8': {
      const top = row(4, nextPaneId, nextSplitId);
      const bottom = row(4, nextPaneId, nextSplitId);
      return split(nextSplitId(), 'v', top, bottom);
    }
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown preset kind: ${_exhaustive as string}`);
    }
  }
}
