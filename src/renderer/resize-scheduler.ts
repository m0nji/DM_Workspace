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
// and the pty resize run in the same tick. xterm reflows once; the process can
// then repaint at that width. Its output still arrives asynchronously.
// ConPTY callers defer height changes too to avoid a 100 ms row mismatch.

export interface ResizeSchedulerOptions {
  /** Perform the fit; return false when the fit could not run (skips the IPC, arms a retry). */
  fit: () => boolean;
  /** Send the pty resize for the current dimensions. */
  sendResize: () => void;
  /**
   * Reflow-relevant width of the host. When provided, fits are deferred while
   * this changes between events and run once after it settles. Without it every
   * resize fits live (height-only semantics).
   */
  getWidth?: () => number;
  /** ConPTY repaints rows as well as columns; settle both dimensions together. */
  deferAll?: boolean;
  raf?: (fn: () => void) => number;
  caf?: (handle: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  debounceMs?: number;
  /**
   * How many times a failed fit is retried before the scheduler stops on its
   * own. Every new resize event refunds the budget, so this only bounds a pane
   * that never becomes fittable — see armRetry.
   */
  maxFitRetries?: number;
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
  const maxFitRetries = opts.maxFitRetries ?? 50;

  let frame: number | null = null;
  let timer: unknown = null; // trailing SIGWINCH debounce (height-only path)
  let settle: unknown = null; // deferred fit while the width is changing
  let retry: unknown = null; // re-attempt after a fit that could not run
  let retriesLeft = maxFitRetries;
  let lastWidth: number | null = null;
  let disposed = false;

  const clearRetry = (): void => {
    if (retry !== null) { clearTimer(retry); retry = null; }
  };

  const cancelPending = (): void => {
    if (frame !== null) { caf(frame); frame = null; }
    if (timer !== null) { clearTimer(timer); timer = null; }
    if (settle !== null) { clearTimer(settle); settle = null; }
    clearRetry();
  };

  // A fit can fail for reasons that pass on their own: the host isn't
  // measurable yet, or the pane hasn't finished spawning (TerminalView's fit
  // returns spawnSent, so the resize IPC can't race ahead of the spawn IPC).
  // Dropping the resize there desyncs xterm from the pty — xterm is fitted to
  // the new size, the shell still runs at the old one, and since the observer
  // has already fired nothing ever reconciles them. So re-arm instead.
  //
  // The budget bounds the one case that never resolves: a pane that stays
  // unmeasurable (a hidden workspace has clientWidth 0). Every real resize
  // event refunds it, so becoming visible buys a fresh set of attempts.
  const armRetry = (): void => {
    if (disposed || retriesLeft <= 0) return;
    retriesLeft--;
    clearRetry();
    retry = setTimer(() => {
      retry = null;
      if (!disposed) fitAndSend();
    }, debounceMs);
  };

  // Send the size in the fit's tick. The process still repaints asynchronously.
  const fitAndSend = (): void => {
    lastWidth = opts.getWidth?.() ?? null;
    if (!opts.fit()) { armRetry(); return; }
    clearRetry();
    opts.sendResize();
  };

  return {
    onResize() {
      if (disposed) return;
      retriesLeft = maxFitRetries;
      if (frame !== null) return;
      frame = raf(() => {
        frame = null;
        if (disposed) return;
        const width = opts.getWidth?.() ?? null;
        // A new observation supersedes every earlier path, including retries.
        // Otherwise a height timer can resize the PTY in the middle of a width
        // drag, or a retry can fit an intermediate width before it has settled.
        if (timer !== null) { clearTimer(timer); timer = null; }
        if (settle !== null) { clearTimer(settle); settle = null; }
        clearRetry();
        if (opts.deferAll || (width !== null && lastWidth !== null && width !== lastWidth)) {
          // Width is changing (splitter drag / window resize): don't reflow at
          // this intermediate width. Re-arm the settle timer; the last event
          // wins and fits + resizes the pty together.
          settle = setTimer(() => {
            settle = null;
            if (!disposed) fitAndSend();
          }, debounceMs);
          return;
        }
        lastWidth = width;
        if (!opts.fit()) { armRetry(); return; }
        clearRetry();
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
      retriesLeft = maxFitRetries;
      fitAndSend();
    },
    dispose() {
      disposed = true;
      cancelPending();
    }
  };
}
