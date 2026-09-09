import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConptyFrameBuffer } from '../src/main/conpty-frame-buffer';

const paint = '\x1b[?2026h\x1b[?25l\x1b[46;1H\x1b[?25h\x1b[0 q\x1b[?2026l';
const correction = '\x1b[?25l \x1b[50;3H\x1b[?25h';

function harness() {
  vi.useFakeTimers();
  const send = vi.fn();
  return { send, buffer: createConptyFrameBuffer(send) };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('ConPTY repaint buffering', () => {
  it('delivers normal shell echo and Unicode immediately', () => {
    const { buffer, send } = harness();
    buffer.push('PS> äöü €');
    expect(send).toHaveBeenCalledExactlyOnceWith('PS> äöü €');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('joins the measured Codex frame and its late cursor correction', () => {
    const { buffer, send } = harness();
    buffer.push(paint);
    vi.advanceTimersByTime(33);
    expect(send).not.toHaveBeenCalled();
    buffer.push(correction);
    vi.advanceTimersByTime(39);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledExactlyOnceWith(paint + correction);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recognizes a sync marker split at any native chunk boundary without altering bytes', () => {
    vi.useFakeTimers();
    for (let split = 1; split < '\x1b[?2026h'.length; split++) {
      const sent: string[] = [];
      const buffer = createConptyFrameBuffer(data => sent.push(data));
      buffer.push(paint.slice(0, split));
      buffer.push(paint.slice(split));
      buffer.push(correction);
      vi.advanceTimersByTime(40);
      expect(sent.join('')).toBe(paint + correction);
      expect(sent.at(-1)).toContain(correction);
      buffer.dispose();
    }
  });

  it('bounds latency even when output never becomes quiet', () => {
    const { buffer, send } = harness();
    buffer.push(paint);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(20);
      buffer.push('more');
    }
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(send).toHaveBeenCalledExactlyOnceWith(paint + 'more'.repeat(4));
  });

  it('flushes before exit and never sends the same bytes again', () => {
    const { buffer, send } = harness();
    buffer.push(paint);
    buffer.flush();
    buffer.dispose();
    vi.runAllTimers();
    expect(send).toHaveBeenCalledExactlyOnceWith(paint);
  });

  it('drops disposed output and does not retain timers', () => {
    const { buffer, send } = harness();
    buffer.push(paint);
    buffer.dispose();
    buffer.push(correction);
    buffer.flush();
    vi.runAllTimers();
    expect(send).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds memory and keeps byte order during a flood', () => {
    const { buffer, send } = harness();
    const flood = 'x'.repeat(256 * 1024);
    buffer.push(paint);
    buffer.push(flood);
    expect(send).toHaveBeenCalledExactlyOnceWith(paint + flood);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps separate terminals independent', () => {
    const { buffer, send } = harness();
    const otherSend = vi.fn();
    const other = createConptyFrameBuffer(otherSend);
    buffer.push(paint);
    other.push('prompt');
    expect(otherSend).toHaveBeenCalledExactlyOnceWith('prompt');
    expect(send).not.toHaveBeenCalled();
    buffer.dispose();
    other.dispose();
  });
});
