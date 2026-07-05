import { describe, it, expect } from 'vitest';
import { createPtyDataBatcher } from '../src/main/pty-data-batcher';

function harness(opts: { windowMs?: number; maxBytes?: number } = {}) {
  const sent: Array<{ paneId: string; data: string }> = [];
  let fire: (() => void) | null = null;
  let setCalls = 0;
  const batcher = createPtyDataBatcher({
    send: (paneId, data) => sent.push({ paneId, data }),
    windowMs: opts.windowMs ?? 5,
    maxBytes: opts.maxBytes ?? 1024,
    setTimer: (fn) => { setCalls++; fire = fn; return 1; },
    clearTimer: () => { fire = null; }
  });
  return {
    sent,
    batcher,
    setCalls: () => setCalls,
    tick: () => { const f = fire; fire = null; f?.(); }
  };
}

describe('pty-data-batcher', () => {
  it('does not send immediately; the timer flush sends buffered chunks as one message', () => {
    const h = harness();
    h.batcher.push('p1', 'a');
    h.batcher.push('p1', 'b');
    h.batcher.push('p1', 'c');
    expect(h.sent).toEqual([]);
    h.tick();
    expect(h.sent).toEqual([{ paneId: 'p1', data: 'abc' }]);
  });

  it('arms the timer only once per window', () => {
    const h = harness();
    h.batcher.push('p1', 'a');
    h.batcher.push('p1', 'b');
    h.batcher.push('p2', 'x');
    expect(h.setCalls()).toBe(1);
    h.tick();
    // next burst arms a fresh timer
    h.batcher.push('p1', 'd');
    expect(h.setCalls()).toBe(2);
  });

  it('keeps panes separate: one message per pane on flush', () => {
    const h = harness();
    h.batcher.push('p1', 'a');
    h.batcher.push('p2', 'x');
    h.batcher.push('p1', 'b');
    h.tick();
    expect(h.sent).toEqual([
      { paneId: 'p1', data: 'ab' },
      { paneId: 'p2', data: 'x' }
    ]);
  });

  it('flushes a pane immediately when its buffer exceeds maxBytes', () => {
    const h = harness({ maxBytes: 4 });
    h.batcher.push('p1', 'abc');
    expect(h.sent).toEqual([]);
    h.batcher.push('p1', 'de'); // 5 chars > 4 → immediate flush of everything buffered
    expect(h.sent).toEqual([{ paneId: 'p1', data: 'abcde' }]);
    // the timer flush afterwards must not resend
    h.tick();
    expect(h.sent).toEqual([{ paneId: 'p1', data: 'abcde' }]);
  });

  it('flushPane sends that pane now and leaves other panes buffered', () => {
    const h = harness();
    h.batcher.push('p1', 'a');
    h.batcher.push('p2', 'x');
    h.batcher.flushPane('p1');
    expect(h.sent).toEqual([{ paneId: 'p1', data: 'a' }]);
    h.tick();
    expect(h.sent).toEqual([
      { paneId: 'p1', data: 'a' },
      { paneId: 'p2', data: 'x' }
    ]);
  });

  it('flushPane with nothing buffered sends nothing', () => {
    const h = harness();
    h.batcher.flushPane('p1');
    expect(h.sent).toEqual([]);
  });

  it('dispose drops buffered data and cancels the timer', () => {
    const h = harness();
    h.batcher.push('p1', 'a');
    h.batcher.dispose();
    h.tick();
    expect(h.sent).toEqual([]);
  });
});
