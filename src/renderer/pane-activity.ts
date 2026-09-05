import type { PaneStatus } from '../shared/types';

export interface PaneActivityOptions {
  silenceMs?: number; // output-silence threshold; legacy "done" means quiet, not completion
  onChange: (status: PaneStatus) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
}

export interface PaneActivity {
  onOutput(): void;
  onInput(): void;
  getStatus(): PaneStatus;
  reset(): void;
  dispose(): void;
}

// Pure status machine derived from the raw PTY stream (we cannot inspect the
// process itself): output -> busy; activity + silence -> done (quiet, not finished); input after done
// -> idle. Input during busy extends that activity instead of toggling state.
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
  const armDone = (): void => {
    clear();
    timer = opts.setTimer(() => { timer = null; setStatus('done'); }, silenceMs);
  };

  return {
    onOutput(): void {
      setStatus('busy');
      armDone();
    },
    onInput(): void {
      // Input while output is still active is activity, not an acknowledgement.
      // Keep `busy` stable so the workspace indicator's CSS animation does not
      // get removed and recreated for every key press. The silence window starts
      // again at the input, just as it does for output. Only input after `done`
      // acknowledges the ready marker and returns the pane to neutral `idle`.
      if (status === 'busy') {
        armDone();
        return;
      }
      clear();
      setStatus('idle');
    },
    getStatus(): PaneStatus { return status; },
    reset(): void { clear(); setStatus('idle'); },
    dispose(): void { clear(); }
  };
}
