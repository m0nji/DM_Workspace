import { describe, it, expect, vi } from 'vitest';
import { createSplitDrag } from '../src/renderer/split-drag';

describe('createSplitDrag', () => {
  it('previews every move without persisting, then persists the last ratio on end', () => {
    const resize = vi.fn();
    const drag = createSplitDrag(resize);
    drag.move(0.3);
    drag.move(0.35);
    drag.end();
    expect(resize.mock.calls).toEqual([[0.3, false], [0.35, false], [0.35, true]]);
  });

  // Ein Klick auf den Trenner ist mousedown + mouseup ohne mousemove. Das darf
  // das bestehende Verhältnis weder überschreiben noch speichern.
  it('does nothing when the pointer never moved', () => {
    const resize = vi.fn();
    createSplitDrag(resize).end();
    expect(resize).not.toHaveBeenCalled();
  });
});
