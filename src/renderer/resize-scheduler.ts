// Tames the ResizeObserver → fit → pty:resize pipeline. The observer can fire
// many times per frame during a splitter drag; fitting more than once per frame
// is wasted reflow, and forwarding every fit as a pty:resize sends the shell a
// SIGWINCH storm that forces TUIs (vim, streaming agents) to re-render
// repeatedly. So: fit is coalesced to once per animation frame (the terminal
// still reflows live while dragging), while the resize IPC is trailing-debounced
// — the shell sees one SIGWINCH when the drag settles.

export interface ResizeSchedulerOptions {
  /** Perform the fit; return false when the host isn't measurable (skips the IPC). */
  fit: () => boolean;
  /** Send the pty resize for the current dimensions. */
  sendResize: () => void;
  raf?: (fn: () => void) => number;
  caf?: (handle: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;
}

export interface ResizeScheduler {
  onResize(): void;
  dispose(): void;
}

export function createResizeScheduler(opts: ResizeSchedulerOptions): ResizeScheduler {
  const raf = opts.raf ?? ((fn) => requestAnimationFrame(fn));
  const caf = opts.caf ?? ((h) => cancelAnimationFrame(h));
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = opts.debounceMs ?? 100;

  let frame: number | null = null;
  let timer: unknown = null;
  let disposed = false;

  return {
    onResize() {
      if (disposed || frame !== null) return;
      frame = raf(() => {
        frame = null;
        if (disposed || !opts.fit()) return;
        // Re-arm on every successful fit so the IPC fires once, after the last one.
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => {
          timer = null;
          if (!disposed) opts.sendResize();
        }, debounceMs);
      });
    },
    dispose() {
      disposed = true;
      if (frame !== null) { caf(frame); frame = null; }
      if (timer !== null) { clearTimer(timer); timer = null; }
    }
  };
}
