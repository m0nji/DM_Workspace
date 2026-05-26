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
