import { describe, it, expect, vi } from 'vitest';

// node-pty is built against Electron's ABI (see postinstall electron-rebuild).
// Under plain Node (Vitest) it may fail to load; in that case we skip these
// integration tests — real terminal behavior is verified by the Electron E2E (Task 21).
let PtyManagerCtor: typeof import('../src/main/pty-manager').PtyManager | undefined;
try {
  ({ PtyManager: PtyManagerCtor } = await import('../src/main/pty-manager'));
} catch {
  PtyManagerCtor = undefined;
}

const suite = PtyManagerCtor ? describe : describe.skip;

suite('PtyManager', () => {
  it('spawns a shell, streams data, and echoes typed input', async () => {
    const PtyManager = PtyManagerCtor!;
    const mgr = new PtyManager();
    const chunks: string[] = [];
    mgr.onData((paneId, data) => { if (paneId === 'p1') chunks.push(data); });
    mgr.spawn('p1', { cwd: process.cwd(), cols: 80, rows: 24 });
    mgr.write('p1', 'echo DMWS_MARKER_123\r');
    await vi.waitFor(() => {
      expect(chunks.join('')).toContain('DMWS_MARKER_123');
    }, { timeout: 5000, interval: 100 });
    mgr.kill('p1');
  });

  it('kill removes the pane so further writes are no-ops', () => {
    const PtyManager = PtyManagerCtor!;
    const mgr = new PtyManager();
    mgr.spawn('p2', { cwd: process.cwd(), cols: 80, rows: 24 });
    mgr.kill('p2');
    expect(() => mgr.write('p2', 'x')).not.toThrow();
  });
});
