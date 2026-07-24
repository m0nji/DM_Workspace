import { describe, it, expect } from 'vitest';
import { createResizeScheduler } from '../src/renderer/resize-scheduler';

function harness(fitResult: () => boolean = () => true, getWidth?: () => number) {
  let fits = 0;
  let resizes = 0;
  let rafCb: (() => void) | null = null;
  let rafCalls = 0;
  // Multiple timers can be live at once (SIGWINCH debounce + width settle).
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const sched = createResizeScheduler({
    fit: () => { fits++; return fitResult(); },
    sendResize: () => { resizes++; },
    getWidth,
    raf: (fn) => { rafCalls++; rafCb = fn; return 1; },
    caf: () => { rafCb = null; },
    setTimer: (fn) => { const id = nextTimer++; timers.set(id, fn); return id; },
    clearTimer: (h) => { timers.delete(h as number); },
    debounceMs: 100
  });
  return {
    sched,
    fits: () => fits,
    resizes: () => resizes,
    rafCalls: () => rafCalls,
    fireRaf: () => { const f = rafCb; rafCb = null; f?.(); },
    fireTimer: () => {
      const [id, f] = [...timers.entries()][0] ?? [];
      if (id !== undefined) { timers.delete(id); f?.(); }
    },
    fireAllTimers: () => {
      for (const [id, f] of [...timers.entries()]) { timers.delete(id); f(); }
    },
    timerPending: () => timers.size > 0
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

  it('flush cancels queued work and immediately fits and resizes once', () => {
    const h = harness();
    h.sched.onResize();
    h.sched.flush();
    expect(h.fits()).toBe(1);
    expect(h.resizes()).toBe(1);
    expect(h.timerPending()).toBe(false);
    h.fireRaf();
    h.fireAllTimers();
    expect(h.fits()).toBe(1);
    expect(h.resizes()).toBe(1);
  });

  it('flush skips the PTY resize when the immediate fit fails', () => {
    const h = harness(() => false);
    h.sched.flush();
    expect(h.fits()).toBe(1);
    expect(h.resizes()).toBe(0);
  });
});

// Width changes reflow wrapped lines. A TUI on the normal buffer (Claude Code,
// Codex) repaints via cursor-up over rows whose wrapping just changed, so every
// intermediate width leaves a generation of garbled rows behind. The scheduler
// therefore defers the fit until the width settles and sends the pty resize in
// the same tick, so the app and xterm agree on the new width atomically.
describe('resize-scheduler width settle', () => {
  it('fits live while the width is stable (height-only resize)', () => {
    const width = 400;
    const h = harness(() => true, () => width);
    h.sched.onResize();
    h.fireRaf();
    expect(h.fits()).toBe(1); // first event: no previous width → live fit
    h.sched.onResize();
    h.fireRaf();
    expect(h.fits()).toBe(2); // width unchanged → still live
    h.fireTimer();
    expect(h.resizes()).toBe(1); // trailing SIGWINCH as before
  });

  it('defers the fit while the width is changing, then fits + resizes together', () => {
    let width = 400;
    const h = harness(() => true, () => width);
    h.sched.onResize();
    h.fireRaf(); // live fit at 400, arms SIGWINCH debounce
    expect(h.fits()).toBe(1);
    width = 380;
    h.sched.onResize();
    h.fireRaf();
    expect(h.fits()).toBe(1); // width changed → deferred, no fit yet
    width = 350;
    h.sched.onResize();
    h.fireRaf();
    expect(h.fits()).toBe(1); // still dragging → still deferred
    h.fireAllTimers(); // settle
    expect(h.fits()).toBe(2); // one fit at the final width
    expect(h.resizes()).toBeGreaterThanOrEqual(1); // pty resized with it
  });

  it('does not send the pty resize when the deferred fit fails', () => {
    let width = 400;
    let fitOk = true;
    const h = harness(() => fitOk, () => width);
    h.sched.onResize();
    h.fireRaf();
    h.fireAllTimers(); // flush initial SIGWINCH debounce
    const before = h.resizes();
    width = 300;
    fitOk = false;
    h.sched.onResize();
    h.fireRaf();
    h.fireAllTimers(); // settle fires, fit fails
    expect(h.resizes()).toBe(before);
  });

  it('dispose cancels a pending settle', () => {
    let width = 400;
    const h = harness(() => true, () => width);
    h.sched.onResize();
    h.fireRaf();
    width = 300;
    h.sched.onResize();
    h.fireRaf();
    h.sched.dispose();
    h.fireAllTimers();
    expect(h.fits()).toBe(1); // only the initial live fit
  });
});
