import { describe, it, expect } from 'vitest';
import { createSaveScheduler } from '../src/renderer/save-scheduler';

function harness() {
  let saves = 0;
  let fire: (() => void) | null = null;
  const delays: number[] = [];
  const sched = createSaveScheduler({
    save: () => { saves++; },
    activeMs: 1000,
    inactiveMs: 15000,
    setTimer: (fn, ms) => { delays.push(ms); fire = fn; return 1; },
    clearTimer: () => { fire = null; }
  });
  return {
    sched,
    saves: () => saves,
    delays,
    tick: () => { const f = fire; fire = null; f?.(); },
    timerPending: () => fire !== null
  };
}

describe('save-scheduler', () => {
  it('coalesces bursts into one save per active interval', () => {
    const h = harness();
    h.sched.schedule();
    h.sched.schedule();
    h.sched.schedule();
    expect(h.saves()).toBe(0);
    expect(h.delays).toEqual([1000]);
    h.tick();
    expect(h.saves()).toBe(1);
  });

  it('uses the slow interval while inactive', () => {
    const h = harness();
    h.sched.setActive(false);
    h.sched.schedule();
    expect(h.delays).toEqual([15000]);
    h.tick();
    expect(h.saves()).toBe(1);
  });

  it('going inactive with a pending save flushes immediately', () => {
    const h = harness();
    h.sched.schedule();
    h.sched.setActive(false);
    expect(h.saves()).toBe(1);
    expect(h.timerPending()).toBe(false);
  });

  it('going inactive with nothing pending does not save', () => {
    const h = harness();
    h.sched.setActive(false);
    expect(h.saves()).toBe(0);
  });

  it('flush saves unconditionally and cancels the timer', () => {
    const h = harness();
    h.sched.schedule();
    h.sched.flush();
    expect(h.saves()).toBe(1);
    expect(h.timerPending()).toBe(false);
    h.sched.flush(); // e.g. clear-buffer with no pending output
    expect(h.saves()).toBe(2);
  });

  it('dispose cancels the pending timer without saving', () => {
    const h = harness();
    h.sched.schedule();
    h.sched.dispose();
    h.tick();
    expect(h.saves()).toBe(0);
  });
});
