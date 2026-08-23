import { describe, it, expect } from 'vitest';
import { resolveTabDropIntent } from '../src/shared/tab-drop-intent';

describe('resolveTabDropIntent', () => {
  it('splits a register into three equal zones', () => {
    expect(resolveTabDropIntent(5, 0, 90)).toBe('before');
    expect(resolveTabDropIntent(45, 0, 90)).toBe('into');
    expect(resolveTabDropIntent(85, 0, 90)).toBe('after');
  });

  it('gives each boundary to the later zone', () => {
    expect(resolveTabDropIntent(29, 0, 90)).toBe('before');
    expect(resolveTabDropIntent(30, 0, 90)).toBe('into');
    expect(resolveTabDropIntent(59, 0, 90)).toBe('into');
    expect(resolveTabDropIntent(60, 0, 90)).toBe('after');
  });

  it('respects an offset start, so a register at any position splits the same way', () => {
    expect(resolveTabDropIntent(205, 200, 90)).toBe('before');
    expect(resolveTabDropIntent(245, 200, 90)).toBe('into');
    expect(resolveTabDropIntent(285, 200, 90)).toBe('after');
  });

  it('falls to the nearest end when the pointer has left the register', () => {
    expect(resolveTabDropIntent(-50, 0, 90)).toBe('before');
    expect(resolveTabDropIntent(400, 0, 90)).toBe('after');
  });

  it('never answers "into" for a register that reports no extent', () => {
    // An unmeasurable element must not be able to create a group by accident.
    expect(resolveTabDropIntent(10, 0, 0)).toBe('before');
    expect(resolveTabDropIntent(10, 0, -5)).toBe('before');
    expect(resolveTabDropIntent(10, 0, NaN)).toBe('before');
    expect(resolveTabDropIntent(NaN, 0, 90)).toBe('before');
    expect(resolveTabDropIntent(10, NaN, 90)).toBe('before');
  });

  // The existing reorder spec drags to fixed offsets. Both must stay in the
  // outer thirds, or introducing the middle zone silently turns a documented
  // reorder into a grouping. See e2e/workspace-navigation-placement.spec.ts:96.
  it('keeps the coordinates the existing reorder e2e spec drags to', () => {
    // Sidebar row, ~30px tall, dropped at y = 2.
    expect(resolveTabDropIntent(2, 0, 30)).toBe('before');
    // Top tab, 180px wide (the max-width in styles.css), dropped at x = width - 2.
    expect(resolveTabDropIntent(178, 0, 180)).toBe('after');
  });
});
