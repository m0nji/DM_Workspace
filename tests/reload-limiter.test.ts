import { describe, it, expect } from 'vitest';
import { createReloadLimiter } from '../src/main/reload-limiter';

describe('createReloadLimiter', () => {
  it('allows up to max reloads inside the window, then refuses', () => {
    const t = 0;
    const allow = createReloadLimiter(3, 60_000, () => t);
    expect([allow(), allow(), allow(), allow()]).toEqual([true, true, true, false]);
  });

  it('allows again once old reloads fall out of the window', () => {
    let t = 0;
    const allow = createReloadLimiter(2, 60_000, () => t);
    allow(); allow();
    expect(allow()).toBe(false);
    t = 60_000;
    expect(allow()).toBe(true);
  });

  it('does not count refused attempts against the budget', () => {
    let t = 0;
    const allow = createReloadLimiter(1, 1000, () => t);
    allow();
    t = 500; expect(allow()).toBe(false);
    t = 1000; expect(allow()).toBe(true);
  });
});
