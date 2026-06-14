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

// Return a structurally identical layout with freshly generated pane and split
// ids (direction and ratio preserved). Replacing the pane ids forces React to
// remount each TerminalView, which respawns its PTY — used to restart a
// workspace's terminals in a new working directory.
export function reassignIds(
  node: LayoutNode,
  nextPaneId: () => string,
  nextSplitId: () => string
): LayoutNode {
  if (node.type === 'pane') return makePane(nextPaneId());
  return {
    ...node,
    id: nextSplitId(),
    children: [
      reassignIds(node.children[0], nextPaneId, nextSplitId),
      reassignIds(node.children[1], nextPaneId, nextSplitId)
    ]
  };
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
  return {
    ...node,
    children: [
      splitPane(node.children[0], targetPaneId, direction, newPaneId, newSplitId, ratio),
      splitPane(node.children[1], targetPaneId, direction, newPaneId, newSplitId, ratio)
    ]
  };
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
  return {
    ...node,
    children: [setRatio(node.children[0], splitId, ratio), setRatio(node.children[1], splitId, ratio)]
  };
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
