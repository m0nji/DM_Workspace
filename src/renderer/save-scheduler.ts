// Schedules the scrollback serialize for a pane. Serializing walks the whole
// xterm buffer synchronously on the renderer's main thread, so panes in hidden
// workspaces must not do it every second just because a background process keeps
// producing output — they save on a much slower cadence, plus once immediately
// when their workspace is switched away (so what you last saw is what a crash
// would restore). Active panes keep the original 1s coalescing.

export interface SaveSchedulerOptions {
  save: () => void;
  activeMs?: number;
  inactiveMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface SaveScheduler {
  /** Mark dirty: arm the interval timer if not already pending. */
  schedule(): void;
  /** Save now, unconditionally, and cancel any pending timer. */
  flush(): void;
  /** Track workspace visibility; going hidden flushes a pending save. */
  setActive(active: boolean): void;
  dispose(): void;
}

export function createSaveScheduler(opts: SaveSchedulerOptions): SaveScheduler {
  const activeMs = opts.activeMs ?? 1000;
  const inactiveMs = opts.inactiveMs ?? 15000;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let active = true;
  let timer: unknown = null;

  const cancel = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
  };

  return {
    schedule() {
      if (timer !== null) return; // coalesce bursts into one save per interval
      timer = setTimer(() => { timer = null; opts.save(); }, active ? activeMs : inactiveMs);
    },
    flush() {
      cancel();
      opts.save();
    },
    setActive(next) {
      const wasActive = active;
      active = next;
      // Hidden panes save on a slow cadence, so capture the pane's final state at
      // the moment it disappears; without pending output there is nothing new.
      if (wasActive && !next && timer !== null) {
        cancel();
        opts.save();
      }
    },
    dispose() {
      cancel();
    }
  };
}
