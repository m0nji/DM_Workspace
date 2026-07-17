// Tames the ResizeObserver → fit → pty:resize pipeline. The observer can fire
// many times per frame during a splitter drag; fitting more than once per frame
// is wasted reflow, and forwarding every fit as a pty:resize sends the shell a
// SIGWINCH storm that forces TUIs (vim, streaming agents) to re-render
// repeatedly.
//
// Height-only resizes are cheap and safe: fit is coalesced to once per
// animation frame (the terminal reflows live while a vertical splitter is
// dragged), while the resize IPC is trailing-debounced — the shell sees one
// SIGWINCH when the drag settles.
//
// Width changes are handled differently. Changing the column count reflows
// every wrapped line, but a TUI on the normal buffer (Claude Code, Codex)
// keeps repainting via cursor-up over rows whose wrapping just changed — every
// intermediate width leaves a generation of torn rows in the buffer. So while
// the width is changing the fit itself is deferred; when it settles, the fit
// and the pty resize run in the same tick, so xterm reflows exactly once and
// the app immediately repaints at the width xterm actually has.

export interface ResizeSchedulerOptions {
  /** Perform the fit; return false when the host isn't measurable (skips the IPC). */
  fit: () => boolean;
  /** Send the pty resize for the current dimensions. */
  sendResize: () => void;
  /**
   * Reflow-relevant width of the host. When provided, fits are deferred while
   * this changes between events and run once after it settles. Without it every
   * resize fits live (height-only semantics).
   */
  getWidth?: () => number;
  raf?: (fn: () => void) => number;
  caf?: (handle: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;
}

export interface ResizeScheduler {
  onResize(): void;
  /** Immediately settle a programmatic layout change at the current size. */
  flush(): void;
  dispose(): void;
}

export function createResizeScheduler(opts: ResizeSchedulerOptions): ResizeScheduler {
  const raf = opts.raf ?? ((fn) => requestAnimationFrame(fn));
  const caf = opts.caf ?? ((h) => cancelAnimationFrame(h));
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const debounceMs = opts.debounceMs ?? 100;

  let frame: number | null = null;
  let timer: unknown = null; // trailing SIGWINCH debounce (height-only path)
  let settle: unknown = null; // deferred fit while the width is changing
  let lastWidth: number | null = null;
  let disposed = false;

  const cancelPending = (): void => {
    if (frame !== null) { caf(frame); frame = null; }
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (settle !== null) { clearTimer(settle); settle = null; }
  };

  return {
    onResize() {
      if (disposed || frame !== null) return;
      frame = raf(() => {
        frame = null;
        if (disposed) return;
        const width = opts.getWidth?.() ?? null;
        if (width !== null && lastWidth !== null && width !== lastWidth) {
          // Width is changing (splitter drag / window resize): don't reflow at
          // this intermediate width. Re-arm the settle timer; the last event
          // wins and fits + resizes the pty together.
          if (settle !== null) clearTimer(settle);
          settle = setTimer(() => {
            settle = null;
            if (disposed) return;
            lastWidth = opts.getWidth?.() ?? null;
            if (opts.fit()) opts.sendResize();
          }, debounceMs);
          return;
        }
        lastWidth = width;
        if (!opts.fit()) return;
        // Re-arm on every successful fit so the IPC fires once, after the last one.
        if (timer !== null) clearTimer(timer);
        timer = setTimer(() => {
          timer = null;
          if (!disposed) opts.sendResize();
        }, debounceMs);
      });
    },
    flush() {
      if (disposed) return;
      cancelPending();
      lastWidth = opts.getWidth?.() ?? null;
      if (opts.fit()) opts.sendResize();
    },
    dispose() {
      disposed = true;
      cancelPending();
    }
  };
}
