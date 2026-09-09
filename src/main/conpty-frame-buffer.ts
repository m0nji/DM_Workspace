// ConPTY can close a synchronized-output frame with the cursor in a temporary
// position, then emit its correction in a separate write (observed 6–33 ms later
// with Codex 0.153.4). Passing both writes to xterm separately exposes that cursor.
// Coalesce these bursts without interpreting, dropping or rewriting VT bytes.
// Ordinary shell echo is passed through immediately. Only the local Windows PTY
// installs this buffer; macOS, Linux and remote terminals keep their usual path.
export function createConptyFrameBuffer(send: (data: string) => void) {
  const QUIET_MS = 40;
  const MAX_WAIT_MS = 100;
  const MAX_LENGTH = 256 * 1024;
  const SYNC_PREFIX = '\x1b[?2026';
  let tail = '';
  let chunks: string[] = [];
  let length = 0;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const cancel = (): void => {
    clearTimeout(quietTimer);
    clearTimeout(deadline);
    quietTimer = deadline = undefined;
  };
  const flush = (): void => {
    cancel();
    if (!chunks.length) return;
    const data = chunks.join('');
    chunks = [];
    length = 0;
    send(data);
  };

  return {
    push(data: string): void {
      if (disposed || !data) return;
      // Carry only the possible prefix across native pipe chunk boundaries.
      // A false match inside an OSC string merely delays the unchanged bytes.
      const probe = tail + data;
      tail = probe.slice(-(SYNC_PREFIX.length - 1));
      if (!chunks.length && !probe.includes(SYNC_PREFIX)) {
        send(data);
        return;
      }
      chunks.push(data);
      length += data.length;
      if (length >= MAX_LENGTH) { flush(); return; }
      if (deadline === undefined) deadline = setTimeout(flush, MAX_WAIT_MS);
      clearTimeout(quietTimer);
      quietTimer = setTimeout(flush, QUIET_MS);
    },
    flush,
    dispose(): void {
      disposed = true;
      cancel();
      chunks = [];
      length = 0;
      tail = '';
    }
  };
}
