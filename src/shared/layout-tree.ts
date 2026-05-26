import type { LayoutNode, PaneNode, SplitNode, Direction, PresetKind } from './types';

export function makePane(id: string): PaneNode {
  return { type: 'pane', id };
}

export function collectPaneIds(node: LayoutNode | null): string[] {
  if (node === null) return [];
  if (node.type === 'pane') return [node.id];
  return [...collectPaneIds(node.children[0]), ...collectPaneIds(node.children[1])];
}
