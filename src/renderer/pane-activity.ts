import type { PaneStatus } from '../shared/types';

export interface PaneActivityOptions {
  silenceMs?: number; // how long output must stop before a pane counts as "done"
  onChange: (status: PaneStatus) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface PaneActivity {
  onOutput(): void;
  onInput(): void;
  getStatus(): PaneStatus;
  dispose(): void;
}

// Pure status machine derived from the raw PTY stream (we cannot inspect the
// process itself): output -> busy; busy + silence -> done; user input -> idle.
export function createPaneActivity(opts: PaneActivityOptions): PaneActivity {
  const silenceMs = opts.silenceMs ?? 2000;
  let status: PaneStatus = 'idle';
  let timer: unknown = null;

  const setStatus = (next: PaneStatus): void => {
    if (next === status) return;
    status = next;
    opts.onChange(next);
  };
  const clear = (): void => {
    if (timer != null) { opts.clearTimer(timer); timer = null; }
  };

  return {
    onOutput(): void {
      setStatus('busy');
      clear();
      timer = opts.setTimer(() => { timer = null; setStatus('done'); }, silenceMs);
    },
    onInput(): void {
      clear();
      setStatus('idle');
    },
    getStatus(): PaneStatus { return status; },
    dispose(): void { clear(); }
  };
}
