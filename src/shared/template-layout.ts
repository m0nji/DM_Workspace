import type { LayoutNode } from './types';

export interface ClonedTemplateLayout {
  layout: LayoutNode;
  paneIdMap: Record<string, string>; // old (template) pane id -> new pane id
}

// Clone a template's layout, assigning fresh pane/split ids while preserving
// direction and ratio. Returns the new layout plus the old→new pane id mapping
// so pane-keyed metadata (titles, startup commands) can be remapped.
export function cloneTemplateLayout(
  node: LayoutNode,
  nextPaneId: () => string,
  nextSplitId: () => string
): ClonedTemplateLayout {
  const paneIdMap: Record<string, string> = {};

  const clone = (current: LayoutNode): LayoutNode => {
    if (current.type === 'pane') {
      const id = nextPaneId();
      paneIdMap[current.id] = id;
      return { type: 'pane', id };
    }
    return {
      type: 'split',
      id: nextSplitId(),
      direction: current.direction,
      ratio: current.ratio,
      children: [clone(current.children[0]), clone(current.children[1])]
    };
  };

  return { layout: clone(node), paneIdMap };
}

// Re-key a pane-keyed string map onto new pane ids, dropping entries whose pane
// no longer exists or whose value is blank. Returns undefined when empty.
export function remapStringMap(
  source: Record<string, string> | undefined,
  paneIdMap: Record<string, string>
): Record<string, string> | undefined {
  if (!source) return undefined;
  const next: Record<string, string> = {};
  for (const [oldId, value] of Object.entries(source)) {
    const newId = paneIdMap[oldId];
    if (newId && value.trim()) next[newId] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
