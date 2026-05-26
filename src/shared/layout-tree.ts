import type { LayoutNode, PaneNode, SplitNode, Direction, PresetKind } from './types';

export function makePane(id: string): PaneNode {
  return { type: 'pane', id };
}

export function collectPaneIds(node: LayoutNode | null): string[] {
  if (node === null) return [];
  if (node.type === 'pane') return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
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
      ratio,
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
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  if (a === node.children[0] && b === node.children[1]) return node; // unchanged
  return { ...node, children: [a, b] };
}

export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === 'pane') return node;
  if (node.id === splitId) {
    const clamped = Math.min(0.9, Math.max(0.1, ratio));
    return { ...node, ratio: clamped };
  }
  return {
    ...node,
    children: [setRatio(node.children[0], splitId, ratio), setRatio(node.children[1], splitId, ratio)]
  };
}
