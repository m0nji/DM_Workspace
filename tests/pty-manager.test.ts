import { describe, it, expect, vi } from 'vitest';

// node-pty is built against Electron's ABI (see postinstall electron-rebuild).
// Under plain Node (Vitest) it may fail to load; in that case we skip these
// integration tests — real terminal behavior is verified by the Electron E2E (Task 21).
// PtyManager also needs Electron's `app` (for the zsh ZDOTDIR integration dir),
// which is undefined outside an Electron runtime — skip there too.
let PtyManagerCtor: typeof import('../src/main/pty-manager').PtyManager | undefined;
let electronAppAvailable = false;
try {
  ({ PtyManager: PtyManagerCtor } = await import('../src/main/pty-manager'));
  const { app } = await import('electron');
  electronAppAvailable = typeof app?.getPath === 'function';
} catch {
  PtyManagerCtor = undefined;
}

const suite = PtyManagerCtor && electronAppAvailable ? describe : describe.skip;

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

  it('does not echo the cwd hook definition into the terminal output', async () => {
    const PtyManager = PtyManagerCtor!;
    const mgr = new PtyManager();
    const chunks: string[] = [];
    mgr.onData((paneId, data) => { if (paneId === 'p3') chunks.push(data); });
    mgr.spawn('p3', { cwd: process.cwd(), cols: 80, rows: 24 });
    // give the shell time to start and print its first prompt
    await new Promise((r) => setTimeout(r, 1500));
    expect(chunks.join('')).not.toContain('__dmws_cwd(){');
    mgr.kill('p3');
  });
});
