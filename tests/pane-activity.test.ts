import { describe, it, expect } from 'vitest';
import { createPaneActivity } from '../src/renderer/pane-activity';

function harness() {
  const changes: string[] = [];
  let fire: (() => void) | null = null;
  const act = createPaneActivity({
    silenceMs: 2000,
    onChange: (s) => changes.push(s),
    setTimer: (fn) => { fire = fn; return 1; },
    clearTimer: () => { fire = null; }
  });
  return { changes, act, tick: () => { const f = fire; fire = null; f?.(); } };
}

describe('pane-activity', () => {
  it('goes busy on output, then done after silence', () => {
    const h = harness();
    h.act.onOutput();
    expect(h.changes).toEqual(['busy']);
    h.tick();
    expect(h.changes).toEqual(['busy', 'done']);
  });

  it('coalesces repeated output into a single busy transition', () => {
    const h = harness();
    h.act.onOutput();
    h.act.onOutput();
    h.act.onOutput();
    expect(h.changes).toEqual(['busy']);
  });

  it('input after done resets to idle and clears the done marker', () => {
    const h = harness();
    h.act.onOutput();
    h.tick();
    h.act.onInput();
    expect(h.changes).toEqual(['busy', 'done', 'idle']);
  });

  it('input while busy keeps the visible state stable and restarts the silence window', () => {
    const h = harness();
    h.act.onOutput();
    h.act.onInput();
    // No busy -> idle -> busy transition: a running CSS animation therefore
    // remains attached instead of visibly restarting for every typed key.
    expect(h.changes).toEqual(['busy']);
    h.tick();
    expect(h.changes).toEqual(['busy', 'done']);
  });

  it('does not emit duplicate statuses', () => {
    const h = harness();
    h.act.onInput();
    expect(h.changes).toEqual([]);
  });
});
