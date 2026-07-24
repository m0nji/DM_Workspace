import { test, expect, _electron as electron } from '@playwright/test';

// When the GPU/WebGL context is lost mid-session (GPU sleep, driver reset, GPU
// switch on a laptop), xterm's WebGL renderer is torn down and the terminal falls
// back to the much slower DOM renderer — visible as sluggish scrolling and a
// different scrollbar. The app must re-acquire a WebGL context automatically
// instead of staying on the DOM renderer until the next workspace switch / restart.
//
// We simulate the loss deterministically with the WEBGL_lose_context extension
// (the same thing you can run by hand in DevTools to reproduce the bug).
test('a lost WebGL context is re-acquired automatically (no permanent DOM-renderer fallback)', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  const canvasCount = () => win.evaluate(() => document.querySelectorAll('.xterm canvas').length);

  // One active pane → it renders via WebGL, so at least one canvas exists.
  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  await win.locator('.pane .xterm-screen').first().waitFor();
  await expect.poll(canvasCount).toBeGreaterThan(0);

  // Force a context loss on the active pane's WebGL canvas. This fires xterm's
  // onContextLoss, which disposes the WebGL addon → the canvases disappear.
  await win.evaluate(() => {
    // xterm's WebGL renderer holds its GL context on exactly one of the canvases;
    // find it (getContext returns the existing context for the matching type, null
    // otherwise) and force the loss on it.
    for (const c of Array.from(document.querySelectorAll('.xterm canvas')) as HTMLCanvasElement[]) {
      const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    }
  });
  // The loss really took effect (we briefly drop to the DOM renderer).
  await expect.poll(canvasCount).toBe(0);

  // The fix: WebGL is re-acquired on its own within a few seconds (canvases come
  // back), with no workspace switch or restart. Without the fix this stays at 0
  // forever — the pane is stuck on the DOM renderer (0 xterm canvases).
  await expect.poll(canvasCount, { timeout: 8000 }).toBeGreaterThan(0);

  await app.close();
});
