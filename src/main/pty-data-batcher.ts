// Coalesce PTY output into one IPC message per pane per short window. node-pty
// delivers high-throughput output (build logs, streaming agents) as many small
// chunks; forwarding each as its own webContents.send saturates the IPC channel
// and the renderer's main thread. Buffering for a few milliseconds cuts the
// message count by orders of magnitude while adding no perceptible latency for
// interactive echo (a lone keystroke flushes after windowMs). A per-pane byte
// cap bounds memory and keeps a flood from sitting in the buffer too long.

export interface PtyDataBatcherOptions {
  send: (paneId: string, data: string) => void;
  /** Flush window in ms; the first push arms it. */
  windowMs?: number;
  /** Per-pane buffered-length cap; exceeding it flushes that pane immediately. */
  maxBytes?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface PtyDataBatcher {
  push(paneId: string, data: string): void;
  /** Flush one pane now (e.g. before its exit event, so exit never outruns output). */
  flushPane(paneId: string): void;
  flushAll(): void;
  dispose(): void;
}

export function createPtyDataBatcher(opts: PtyDataBatcherOptions): PtyDataBatcher {
  const windowMs = opts.windowMs ?? 5;
  const maxBytes = opts.maxBytes ?? 256 * 1024;
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  // chunks are joined once at flush time; length is tracked incrementally so the
  // cap check never re-scans the buffer.
  const buffers = new Map<string, { chunks: string[]; length: number }>();
  let timer: unknown = null;
  let disposed = false;

  const cancelTimer = (): void => {
    if (timer !== null) { clearTimer(timer); timer = null; }
  };

  const flushPane = (paneId: string): void => {
    const buf = buffers.get(paneId);
    if (!buf) return;
    buffers.delete(paneId);
    opts.send(paneId, buf.chunks.join(''));
  };

  const flushAll = (): void => {
    cancelTimer();
    for (const paneId of [...buffers.keys()]) flushPane(paneId);
  };

  return {
    push(paneId, data) {
      if (disposed) return;
      let buf = buffers.get(paneId);
      if (!buf) {
        buf = { chunks: [], length: 0 };
        buffers.set(paneId, buf);
      }
      buf.chunks.push(data);
      buf.length += data.length;
      if (buf.length > maxBytes) {
        flushPane(paneId);
        return;
      }
      if (timer === null) {
        timer = setTimer(() => { timer = null; flushAll(); }, windowMs);
      }
    },
    flushPane,
    flushAll,
    dispose() {
      disposed = true;
      cancelTimer();
      buffers.clear();
    }
  };
}
