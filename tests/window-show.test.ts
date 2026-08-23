import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { wireWindowShow, type ShowableWindow } from '../src/main/window-show';

// Ein BrowserWindow, soweit das Anzeigen es braucht. Die Listener werden
// gesammelt statt ausgeführt, damit ein Test genau den Event feuern kann, der
// im echten Start ankommt — und vor allem den, der ausbleibt.
function fakeWindow(): ShowableWindow & {
  calls: string[];
  emitReadyToShow(): void;
  emitDidFinishLoad(): void;
  hasReadyToShowListener(): boolean;
  destroy(): void;
} {
  let visible = false;
  let destroyed = false;
  const calls: string[] = [];
  const readyToShow: (() => void)[] = [];
  const didFinishLoad: (() => void)[] = [];

  return {
    calls,
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    show() { calls.push('show'); visible = true; },
    // maximize() zeigt ein verstecktes Fenster — genau das ist der Grund, warum
    // 'ready-to-show' danach ausbleibt. Der Fake bildet das nach.
    maximize() { calls.push('maximize'); visible = true; },
    hide() { calls.push('hide'); visible = false; },
    once(_event: 'ready-to-show', listener: () => void) { readyToShow.push(listener); return this; },
    webContents: {
      once(_event: 'did-finish-load', listener: () => void) { didFinishLoad.push(listener); return this; }
    },
    emitReadyToShow() { readyToShow.forEach((l) => l()); },
    emitDidFinishLoad() { didFinishLoad.forEach((l) => l()); },
    hasReadyToShowListener: () => readyToShow.length > 0,
    destroy() { destroyed = true; }
  };
}

describe('wireWindowShow', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('zeigt das Fenster auf ready-to-show, wenn nicht maximiert gestartet wird', () => {
    const win = fakeWindow();
    wireWindowShow(win, { restoreMaximized: false });

    expect(win.calls).toEqual([]);
    win.emitReadyToShow();
    expect(win.calls).toEqual(['show']);
  });

  it('stellt den maximierten Zustand vor dem Laden wieder her', () => {
    const win = fakeWindow();
    wireWindowShow(win, { restoreMaximized: true });

    // maximize vor hide: der Renderer soll auf voller Breite layouten, das
    // Fenster dabei aber nicht sichtbar sein.
    expect(win.calls).toEqual(['maximize', 'hide']);
    expect(win.isVisible()).toBe(false);
  });

  // Der eigentliche Regressionstest — 0.14.0 bis 0.14.2.
  //
  // Im echten maximierten Start kommt NUR did-finish-load an: 'ready-to-show'
  // emittiert Electron ausschliesslich für ein Fenster, das noch nie gezeigt
  // wurde, und maximize() hat es bereits gezeigt. Wer die Anzeige allein an
  // 'ready-to-show' hängt, bekommt einen laufenden Prozess ohne Fenster.
  it('zeigt das maximierte Fenster, obwohl ready-to-show nie feuert', () => {
    const win = fakeWindow();
    wireWindowShow(win, { restoreMaximized: true });

    win.emitDidFinishLoad();

    expect(win.calls).toEqual(['maximize', 'hide', 'show']);
    expect(win.isVisible()).toBe(true);
  });

  it('verlaesst sich im maximierten Fall nicht auf ready-to-show', () => {
    const win = fakeWindow();
    wireWindowShow(win, { restoreMaximized: true });

    // Kein Listener an einem Event, der bauartbedingt nicht mehr kommt: sonst
    // sieht die Verdrahtung richtig aus und ist es nicht.
    expect(win.hasReadyToShowListener()).toBe(false);
  });

  it('zeigt das Fenster notfalls per Reissleine, wenn kein Event kommt', () => {
    const win = fakeWindow();
    const onFallback = vi.fn();
    wireWindowShow(win, { restoreMaximized: false, fallbackMs: 10_000, onFallback });

    vi.advanceTimersByTime(9_999);
    expect(win.calls).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(win.calls).toEqual(['show']);
    expect(onFallback).toHaveBeenCalledOnce();
  });

  it('laesst die Reissleine nach einem regulaeren Anzeigen nicht mehr greifen', () => {
    const win = fakeWindow();
    const onFallback = vi.fn();
    wireWindowShow(win, { restoreMaximized: true, fallbackMs: 10_000, onFallback });

    win.emitDidFinishLoad();
    vi.advanceTimersByTime(60_000);

    expect(win.calls).toEqual(['maximize', 'hide', 'show']);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('zeigt ein zerstoertes Fenster nicht mehr an', () => {
    const win = fakeWindow();
    wireWindowShow(win, { restoreMaximized: false, fallbackMs: 10_000 });

    win.destroy();
    win.emitReadyToShow();
    vi.advanceTimersByTime(60_000);

    expect(win.calls).toEqual([]);
  });

  it('raeumt die Reissleine ab, wenn das Fenster vorher geschlossen wird', () => {
    const win = fakeWindow();
    const onFallback = vi.fn();
    const cancel = wireWindowShow(win, { restoreMaximized: false, fallbackMs: 10_000, onFallback });

    cancel();
    vi.advanceTimersByTime(60_000);

    expect(win.calls).toEqual([]);
    expect(onFallback).not.toHaveBeenCalled();
  });
});
