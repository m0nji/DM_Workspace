// Spatial pane navigation. The layout is a binary tree in which every split
// knows its direction and ratio, so each pane's position is computable from
// the tree alone — no DOM measurement, which keeps this whole module pure and
// testable without jsdom.
import type { LayoutNode } from './types';

/** A pane's position in normalized 0..1 coordinates of the workspace area. */
export interface PaneRect { paneId: string; x: number; y: number; w: number; h: number; }

export type NavDirection = 'left' | 'right' | 'up' | 'down';

// Absorbs floating-point drift from nested ratios: a neighbour's edge that
// should coincide with ours may land a few ulps off.
const EPS = 1e-6;

export function paneRects(node: LayoutNode | null, x = 0, y = 0, w = 1, h = 1): PaneRect[] {
  if (node === null) return [];
  if (node.type === 'pane') return [{ paneId: node.id, x, y, w, h }];
  if (node.direction === 'h') {
    const first = w * node.ratio;
    return [
      ...paneRects(node.children[0], x, y, first, h),
      ...paneRects(node.children[1], x + first, y, w - first, h)
    ];
  }
  const first = h * node.ratio;
  return [
    ...paneRects(node.children[0], x, y, w, first),
    ...paneRects(node.children[1], x, y + first, w, h - first)
  ];
}

// Per-direction view of a rect, so one search serves all four directions:
// `gap` is the distance from the source's leading edge to the candidate's
// facing edge (negative => the candidate is not in that direction at all),
// `span` is the extent on the cross axis, used for the overlap test.
interface Axis {
  gap: (from: PaneRect, cand: PaneRect) => number;
  span: (r: PaneRect) => [number, number];
}

const AXES: Record<NavDirection, Axis> = {
  right: { gap: (f, c) => c.x - (f.x + f.w), span: (r) => [r.y, r.y + r.h] },
  left:  { gap: (f, c) => f.x - (c.x + c.w), span: (r) => [r.y, r.y + r.h] },
  down:  { gap: (f, c) => c.y - (f.y + f.h), span: (r) => [r.x, r.x + r.w] },
  up:    { gap: (f, c) => f.y - (c.y + c.h), span: (r) => [r.x, r.x + r.w] }
};

interface Candidate { paneId: string; gap: number; overlap: number; lo: number; }

/**
 * The pane adjacent to `fromPaneId` in `direction`, or null at the layout edge
 * (no wrap-around), for an unknown pane, or when no candidate overlaps the
 * source on the cross axis.
 *
 * Only candidates that overlap the source on the cross axis are eligible;
 * among those the nearest edge wins, then the larger overlap, then the
 * topmost/leftmost. Every tie-break is total, so the result is deterministic.
 * A non-overlapping candidate never has to be considered as a fallback:
 * `paneRects()` produces a gapless guillotine partition of the unit square,
 * so whenever any candidate exists in a direction, some pane must cover the
 * area immediately adjacent to the source's edge within its own span — and
 * that pane overlaps on the cross axis by construction.
 */
export function findPaneInDirection(
  node: LayoutNode | null,
  fromPaneId: string,
  direction: NavDirection
): string | null {
  const rects = paneRects(node);
  const from = rects.find((r) => r.paneId === fromPaneId);
  if (!from) return null;

  const axis = AXES[direction];
  const [fromLo, fromHi] = axis.span(from);

  const candidates: Candidate[] = [];
  for (const cand of rects) {
    if (cand.paneId === fromPaneId) continue;
    const gap = axis.gap(from, cand);
    if (gap < -EPS) continue; // behind us or beside us — not in this direction
    const [lo, hi] = axis.span(cand);
    candidates.push({
      paneId: cand.paneId,
      gap,
      overlap: Math.min(fromHi, hi) - Math.max(fromLo, lo),
      lo
    });
  }

  const overlapping = candidates.filter((c) => c.overlap > EPS);
  if (overlapping.length === 0) return null;
  overlapping.sort((a, b) =>
    (a.gap - b.gap) || (b.overlap - a.overlap) || (a.lo - b.lo) || a.paneId.localeCompare(b.paneId));
  return overlapping[0].paneId;
}
