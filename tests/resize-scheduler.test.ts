import { describe, it, expect } from 'vitest';
import { createResizeScheduler } from '../src/renderer/resize-scheduler';

function harness(fitResult: () => boolean = () => true) {
  let fits = 0;
  let resizes = 0;
  let rafCb: (() => void) | null = null;
  let timerCb: (() => void) | null = null;
  let rafCalls = 0;
  const sched = createResizeScheduler({
    fit: () => { fits++; return fitResult(); },
    sendResize: () => { resizes++; },
    raf: (fn) => { rafCalls++; rafCb = fn; return 1; },
    caf: () => { rafCb = null; },
    setTimer: (fn) => { timerCb = fn; return 1; },
    clearTimer: () => { timerCb = null; },
    debounceMs: 100
  });
  return {
    sched,
    fits: () => fits,
    resizes: () => resizes,
    rafCalls: () => rafCalls,
    fireRaf: () => { const f = rafCb; rafCb = null; f?.(); },
    fireTimer: () => { const f = timerCb; timerCb = null; f?.(); },
    timerPending: () => timerCb !== null
  };
}

describe('resize-scheduler', () => {
  it('coalesces multiple onResize calls into one fit per frame', () => {
    const h = harness();
    h.sched.onResize();
    h.sched.onResize();
    h.sched.onResize();
    expect(h.rafCalls()).toBe(1);
    expect(h.fits()).toBe(0);
    h.fireRaf();
    expect(h.fits()).toBe(1);
  });

  it('debounces sendResize: fires once after the trailing window, not per fit', () => {
    const h = harness();
    h.sched.onResize();
    h.fireRaf();
    expect(h.resizes()).toBe(0); // fit happened, resize IPC deferred
    h.sched.onResize();
    h.fireRaf();
    expect(h.fits()).toBe(2);
    h.fireTimer();
    expect(h.resizes()).toBe(1); // one SIGWINCH for the whole drag
  });

  it('a failed fit does not arm the resize debounce', () => {
    const h = harness(() => false);
    h.sched.onResize();
    h.fireRaf();
    expect(h.fits()).toBe(1);
    expect(h.timerPending()).toBe(false);
    expect(h.resizes()).toBe(0);
  });

  it('a new frame after the timer fired starts a fresh debounce', () => {
    const h = harness();
    h.sched.onResize();
    h.fireRaf();
    h.fireTimer();
    expect(h.resizes()).toBe(1);
    h.sched.onResize();
    h.fireRaf();
    h.fireTimer();
    expect(h.resizes()).toBe(2);
  });

  it('dispose cancels the pending frame and timer', () => {
    const h = harness();
    h.sched.onResize();
    h.sched.dispose();
    h.fireRaf();
    h.fireTimer();
    expect(h.fits()).toBe(0);
    expect(h.resizes()).toBe(0);
  });

  it('dispose after a fit cancels the pending resize IPC', () => {
    const h = harness();
    h.sched.onResize();
    h.fireRaf();
    h.sched.dispose();
    h.fireTimer();
    expect(h.resizes()).toBe(0);
  });
});
