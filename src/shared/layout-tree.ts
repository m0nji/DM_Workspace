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

/** Rand eines Panes, an den ein anderes Pane angedockt werden kann. */
export type DockSide = 'left' | 'right' | 'top' | 'bottom';
/** Ablagezone beim Ziehen eines Panes: ein Rand (andocken) oder die Mitte (tauschen). */
export type PaneDropZone = DockSide | 'center';

/**
 * Welche Zone liegt unter dem Zeiger? `rx`/`ry` sind die relative Position im
 * Ziel-Pane (0..1). Der naechstgelegene Rand gewinnt, wenn der Zeiger im
 * aeusseren Viertel steht -- sonst ist es die Mitte. So bleibt der Tausch
 * (grosse Mittelflaeche) der einfache Fall, und Andocken braucht eine bewusste
 * Bewegung an den Rand.
 */
export function paneDropZoneAt(rx: number, ry: number, edge = 0.25): PaneDropZone {
  const x = Math.min(1, Math.max(0, rx));
  const y = Math.min(1, Math.max(0, ry));
  const distances: Array<[DockSide, number]> = [
    ['left', x], ['right', 1 - x], ['top', y], ['bottom', 1 - y]
  ];
  let best = distances[0];
  for (const d of distances) if (d[1] < best[1]) best = d;
  return best[1] < edge ? best[0] : 'center';
}

export interface Rect { left: number; top: number; right: number; bottom: number; }

/**
 * Liegt der Zeiger (x, y) im schmalen Band am Aussenrand des ganzen Layouts?
 * Gefragt wird aus Sicht eines Ziel-Panes: Nur ein Pane, dessen Kante mit der
 * Layout-Kante zusammenfaellt (Toleranz 2 px), kann diese Zone anbieten. Das
 * Band ist absichtlich schmal (`band` px) -- der Rest der Randzone bleibt das
 * Andocken an DIESES Pane. In einer Ecke gewinnt die naehere Kante.
 */
export function rootDockSideAt(pane: Rect, root: Rect, x: number, y: number, band = 24): DockSide | null {
  const flush = (a: number, b: number): boolean => Math.abs(a - b) <= 2;
  const candidates: Array<[DockSide, number]> = [];
  if (flush(pane.left, root.left)) candidates.push(['left', x - root.left]);
  if (flush(pane.right, root.right)) candidates.push(['right', root.right - x]);
  if (flush(pane.top, root.top)) candidates.push(['top', y - root.top]);
  if (flush(pane.bottom, root.bottom)) candidates.push(['bottom', root.bottom - y]);
  let best: [DockSide, number] | null = null;
  for (const c of candidates) if (c[1] >= 0 && c[1] < band && (!best || c[1] < best[1])) best = c;
  return best ? best[0] : null;
}

/**
 * Pane `sourceId` aus seiner bisherigen Position loesen und an der Seite `side`
 * von `targetId` wieder einsetzen. Die Quelle teilt sich danach den Platz des
 * Ziels 50:50 in einem neuen Split (`newSplitId`); ihr alter Platz faellt dem
 * Geschwister zu, genau wie beim Schliessen.
 *
 * Wie bei swapPanes wandert nur die Pane-ID -- Terminal, Titel und cwd haengen
 * daran und kommen ohne Neustart mit (siehe pane-host.ts).
 *
 * Liegt die Quelle bereits genau dort (direktes Geschwister, gleiche Richtung,
 * gleiche Seite), kommt der Baum unveraendert zurueck, damit das Verhaeltnis
 * nicht grundlos auf 50:50 springt.
 */
export function movePane(
  node: LayoutNode,
  sourceId: string,
  targetId: string,
  side: DockSide,
  newSplitId: string
): LayoutNode {
  if (sourceId === targetId) return node;
  const ids = collectPaneIds(node);
  if (!ids.includes(sourceId) || !ids.includes(targetId)) return node;

  const direction: Direction = side === 'left' || side === 'right' ? 'h' : 'v';
  const sourceFirst = side === 'left' || side === 'top';
  if (alreadyDocked(node, sourceId, targetId, direction, sourceFirst)) return node;

  const without = closePane(node, sourceId);
  if (without === null) return node; // unerreichbar: das Ziel bleibt immer stehen

  const walk = (n: LayoutNode): LayoutNode => {
    if (n.type === 'pane') {
      if (n.id !== targetId) return n;
      const source = makePane(sourceId);
      return split(newSplitId, direction, sourceFirst ? source : n, sourceFirst ? n : source);
    }
    const a = walk(n.children[0]);
    const b = walk(n.children[1]);
    if (a === n.children[0] && b === n.children[1]) return n;
    return { ...n, children: [a, b] };
  };
  return walk(without);
}

/**
 * Pane `sourceId` an den Aussenrand des GANZEN Layouts setzen: Es bekommt die
 * volle Breite (oben/unten) bzw. volle Hoehe (links/rechts), der Rest des
 * Layouts rueckt zusammen. Das ist der Fall, den movePane nicht abdeckt -- dort
 * teilt sich die Quelle immer nur den Platz EINES Panes.
 *
 * Steht die Quelle schon genau so an der Wurzel, kommt der Baum unveraendert
 * zurueck. Ein einzelnes Pane laesst sich nirgendwohin verschieben.
 */
export function dockPaneAtRoot(
  node: LayoutNode,
  sourceId: string,
  side: DockSide,
  newSplitId: string
): LayoutNode {
  if (node.type === 'pane' || !collectPaneIds(node).includes(sourceId)) return node;
  const direction: Direction = side === 'left' || side === 'right' ? 'h' : 'v';
  const sourceFirst = side === 'left' || side === 'top';
  const edgeChild = node.children[sourceFirst ? 0 : 1];
  if (node.direction === direction && edgeChild.type === 'pane' && edgeChild.id === sourceId) return node;

  const rest = closePane(node, sourceId);
  if (rest === null) return node;
  const source = makePane(sourceId);
  return split(newSplitId, direction, sourceFirst ? source : rest, sourceFirst ? rest : source);
}

function alreadyDocked(
  node: LayoutNode,
  sourceId: string,
  targetId: string,
  direction: Direction,
  sourceFirst: boolean
): boolean {
  if (node.type === 'pane') return false;
  const [a, b] = node.children;
  if (node.direction === direction && a.type === 'pane' && b.type === 'pane') {
    const first = sourceFirst ? sourceId : targetId;
    const second = sourceFirst ? targetId : sourceId;
    if (a.id === first && b.id === second) return true;
  }
  return alreadyDocked(a, sourceId, targetId, direction, sourceFirst) ||
    alreadyDocked(b, sourceId, targetId, direction, sourceFirst);
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
