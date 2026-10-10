import { EventEmitter } from 'events';
import { describe, it, expect } from 'vitest';
import { wireWakeRepaint, SYSTEM_WAKE_CHANNEL, type WakeWindow } from '../src/main/wake-repaint';
import { registerTerminalRepaint, unregisterTerminalRepaint, repaintTerminals } from '../src/renderer/terminal-registry';

function fakeWindow(): WakeWindow & { calls: string[]; destroy(): void } {
  let destroyed = false;
  const calls: string[] = [];
  return {
    calls,
    isDestroyed: () => destroyed,
    webContents: {
      invalidate() { calls.push('invalidate'); },
      send(channel: string) { calls.push(`send:${channel}`); }
    },
    destroy() { destroyed = true; }
  };
}

describe('wireWakeRepaint', () => {
  it('repaints the window and notifies the renderer on resume and unlock', () => {
    const power = new EventEmitter();
    const win = fakeWindow();
    wireWakeRepaint(power, win);

    power.emit('resume');
    power.emit('unlock-screen');

    expect(win.calls).toEqual([
      'invalidate', `send:${SYSTEM_WAKE_CHANNEL}`,
      'invalidate', `send:${SYSTEM_WAKE_CHANNEL}`
    ]);
  });

  it('ignores a wake after the window is destroyed', () => {
    const power = new EventEmitter();
    const win = fakeWindow();
    wireWakeRepaint(power, win);
    win.destroy();

    power.emit('resume');

    expect(win.calls).toEqual([]);
  });

  it('unsubscribes both events on dispose', () => {
    const power = new EventEmitter();
    const win = fakeWindow();
    wireWakeRepaint(power, win)();

    expect(power.listenerCount('resume')).toBe(0);
    expect(power.listenerCount('unlock-screen')).toBe(0);
  });
});

describe('repaintTerminals', () => {
  it('repaints every registered terminal until it unregisters', () => {
    const painted: string[] = [];
    registerTerminalRepaint('a', () => painted.push('a'));
    registerTerminalRepaint('b', () => painted.push('b'));

    repaintTerminals();
    unregisterTerminalRepaint('a');
    repaintTerminals();
    unregisterTerminalRepaint('b');

    expect(painted).toEqual(['a', 'b', 'b']);
  });
});
