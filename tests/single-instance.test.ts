import { describe, it, expect, vi, afterEach } from 'vitest';
import { enforceSingleInstance, type FocusableWindow } from '../src/main/single-instance';

function fakeApp(lock: boolean) {
  const listeners: Array<() => void> = [];
  return {
    listeners,
    app: {
      requestSingleInstanceLock: vi.fn(() => lock),
      on: vi.fn((_event: 'second-instance', l: () => void) => { listeners.push(l); }),
      quit: vi.fn()
    }
  };
}

const fakeWindow = (minimized: boolean): FocusableWindow & Record<string, ReturnType<typeof vi.fn>> => ({
  isMinimized: vi.fn(() => minimized), restore: vi.fn(), show: vi.fn(), focus: vi.fn()
});

describe('enforceSingleInstance', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  // Dev-Build und installierte App teilen sich das Profil (userData
  // "dm-workspace"): ein `npm run dev` neben der laufenden App endet sonst
  // stumm. Der Grund gehört ins Terminal des Aufrufers.
  it('says why the second instance quits', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app } = fakeApp(false);
    enforceSingleInstance(app, () => null);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/another instance/i));
  });

  it('quits the second instance and registers nothing', () => {
    const { app, listeners } = fakeApp(false);
    expect(enforceSingleInstance(app, () => null)).toBe(false);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(0);
  });

  it('keeps the first instance running', () => {
    const { app } = fakeApp(true);
    expect(enforceSingleInstance(app, () => null)).toBe(true);
    expect(app.quit).not.toHaveBeenCalled();
  });

  it('brings a minimized window back when a second instance starts', () => {
    const { app, listeners } = fakeApp(true);
    const win = fakeWindow(true);
    enforceSingleInstance(app, () => win);
    listeners[0]();
    expect(win.restore).toHaveBeenCalled();
    expect(win.show).toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('does not restore a window that is not minimized', () => {
    const { app, listeners } = fakeApp(true);
    const win = fakeWindow(false);
    enforceSingleInstance(app, () => win);
    listeners[0]();
    expect(win.restore).not.toHaveBeenCalled();
    expect(win.focus).toHaveBeenCalled();
  });

  it('survives a second instance while no window exists (startup, macOS all-closed)', () => {
    const { app, listeners } = fakeApp(true);
    enforceSingleInstance(app, () => null);
    expect(() => listeners[0]()).not.toThrow();
  });
});
