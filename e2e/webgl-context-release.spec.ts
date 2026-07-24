import { test, expect, _electron as electron } from '@playwright/test';

// Only the active workspace's panes should hold a WebGL/GPU context. xterm's
// WebGL renderer attaches one or more <canvas> elements per terminal; the DOM
// fallback renderer (used while a workspace is inactive) attaches none. So the
// number of `.xterm canvas` elements equals the WebGL footprint of the *visible*
// workspace only — inactive workspaces, though still mounted, contribute zero.
test('inactive workspaces release their WebGL context; switching back restores it', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  const canvasCount = () => win.evaluate(() => document.querySelectorAll('.xterm canvas').length);

  // Workspace 1: one pane. It is active, so it holds a WebGL context.
  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  await win.locator('.pane .xterm-screen').first().waitFor();
  await win.waitForTimeout(500);
  const perPane = await canvasCount();
  expect(perPane).toBeGreaterThan(0); // active pane renders via WebGL

  // Add workspace 2 (becomes active). Workspace 1 is now inactive and must drop
  // its context — at this point ws2 has no pane yet, so the total is zero.
  await win.locator('.add-ws').click();
  await win.getByText('How many terminals do you want to open?').waitFor();
  await expect.poll(canvasCount).toBe(0);

  // Give workspace 2 a pane. Only ws2 is active, so the footprint is one pane's
  // worth — ws1 (inactive, still mounted) keeps contributing nothing.
  await win.getByText('1 Pane').click();
  await win.locator('.ws-host:visible .pane .xterm-screen').first().waitFor();
  await expect.poll(canvasCount).toBe(perPane);

  // Switch back to workspace 1: its terminal must become visible again (not blank)
  // and re-acquire a context, while ws2 releases its own. Footprint stays at one
  // pane's worth — never the sum of both workspaces.
  await win.locator('.ws-item', { hasText: 'Workspace 1' }).click();
  await expect(win.locator('.ws-host:visible .xterm-screen').first()).toBeVisible();
  await expect.poll(canvasCount).toBe(perPane);

  // Switch back to workspace 2 once more — still bounded to one workspace.
  await win.locator('.ws-item', { hasText: 'Workspace 2' }).click();
  await expect(win.locator('.ws-host:visible .xterm-screen').first()).toBeVisible();
  await expect.poll(canvasCount).toBe(perPane);

  await app.close();
});
