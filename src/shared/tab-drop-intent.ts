// What dropping a dragged workspace register onto another one should mean.
//
// Reordering already existed and split each register at its midpoint: the near
// half meant "before", the far half "after". Grouping needs a third answer, so
// the split becomes thirds and the middle one means "put these together".
// Nothing else about the drag changes — the axis is still the one the
// navigation is laid out along (clientX for the top tabs, clientY for the
// sidebar), which is why this takes plain numbers and knows nothing about DOM.
//
// This lives here rather than in the component because the component used to
// decide it twice — once in onDragOver to draw the hint, once in onDrop to act
// on it — and the two had to agree. One function, called from both, cannot
// disagree with itself.
export type TabDropIntent = 'before' | 'into' | 'after';

/**
 * `pointer`, `start` and `size` are all along the axis of the navigation, in
 * the same coordinate space (client pixels). `start` is the leading edge of the
 * register under the pointer, `size` its extent.
 *
 * Boundaries belong to the later zone: exactly one third in is already `into`,
 * exactly two thirds in is already `after`. A pointer outside the register
 * falls to the nearest end, which is what a drag that has just left the element
 * should do.
 */
export function resolveTabDropIntent(pointer: number, start: number, size: number): TabDropIntent {
  // A register that reports no extent cannot be measured into thirds. Answering
  // `into` there would let an unmeasurable element silently create groups, so
  // fall back to the reordering answer the navigation had before groups existed.
  if (!Number.isFinite(size) || size <= 0) return 'before';
  if (!Number.isFinite(pointer) || !Number.isFinite(start)) return 'before';
  const offset = pointer - start;
  if (offset < size / 3) return 'before';
  if (offset < (size * 2) / 3) return 'into';
  return 'after';
}
