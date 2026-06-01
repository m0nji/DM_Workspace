// node-pty reports a child's exit from a worker thread via an N-API
// ThreadSafeFunction. If the process is killed and Electron immediately tears
// down the JS environment, that callback fires into a half-destroyed env, the
// native addon throws a C++ exception that can't be caught, and the process
// abort()s — surfacing as an ugly "DM Workspace quit unexpectedly" dialog
// (notably during auto-update, which force-quits the running app).
//
// killAndWait kills every pty and resolves only once each one has actually
// emitted onExit (so the addon is done touching JS), or after a short safety
// timeout so we never block quitting forever.
export interface KillableProc {
  onExit(listener: (e: { exitCode: number; signal?: number }) => void): unknown;
  kill(signal?: string): void;
}

export function killAndWait(procs: KillableProc[], timeoutMs: number): Promise<void> {
  if (procs.length === 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let remaining = procs.length;
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const tick = (): void => {
      if (--remaining <= 0) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    for (const proc of procs) {
      proc.onExit(tick);
      try {
        proc.kill();
      } catch {
        // Already gone / kill failed — count it as exited so we don't hang.
        tick();
      }
    }
  });
}
