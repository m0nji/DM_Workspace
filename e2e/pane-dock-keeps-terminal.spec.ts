import { test, expect, _electron as electron } from '@playwright/test';
import { waitForShellPrompt } from './wait-helpers';

// Dragging a pane onto the EDGE of another docks it there instead of swapping:
// two side-by-side panes become one above the other. Like the swap, this only
// moves pane ids around the layout tree, so both terminals must keep their live
// DOM host — a remount would replay scrollback under the running shell.
test('dropping a pane on the bottom edge of another docks it below, terminals intact', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('2 side by side').click();
  const panes = win.locator('.pane');
  await expect(panes).toHaveCount(2);
  await waitForShellPrompt(win, 0);
  await waitForShellPrompt(win, 1);

  const rows = (i: number) => panes.nth(i).locator('.xterm-rows');
  for (const i of [0, 1]) {
    await panes.nth(i).locator('.xterm-screen').click();
    await win.keyboard.type(`echo DOCK_PROBE_${i}`);
    await win.keyboard.press('Enter');
    await expect(rows(i)).toContainText(`DOCK_PROBE_${i}\n`);
  }
  await win.evaluate(() => {
    document.querySelectorAll('.pane .xterm-host')
      .forEach((host, i) => host.setAttribute('data-probe', `alive-${i}`));
  });

  // Grab the RIGHT pane and hover the bottom edge of the LEFT one.
  const header = await panes.nth(1).locator('.pane-header').boundingBox();
  const target = await panes.nth(0).boundingBox();
  await win.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
  await win.mouse.down();
  await win.mouse.move(header!.x + header!.width / 2 - 20, header!.y + header!.height / 2 + 5, { steps: 5 });
  await win.mouse.move(target!.x + target!.width / 2, target!.y + target!.height * 0.92, { steps: 12 });

  // The preview names the action and covers the half the pane will get.
  await expect(win.locator('.pane-dock-preview.dock-bottom')).toHaveCount(1);
  await expect(win.locator('.pane-dock-preview')).toContainText('Dock below');
  await expect(win.locator('.pane-drop-hint')).toHaveCount(0);
  await win.mouse.up();

  await expect(panes).toHaveCount(2);
  await expect(win.locator('.pane-dock-preview')).toHaveCount(0);
  await win.waitForTimeout(1200); // a replay (if any) + the refit would land here

  // Now stacked: same left edge, the moved pane sits below the other one.
  const a = (await panes.nth(0).boundingBox())!;
  const b = (await panes.nth(1).boundingBox())!;
  expect(Math.abs(a.x - b.x)).toBeLessThan(2);
  expect(b.y).toBeGreaterThan(a.y + a.height / 2);
  expect(a.width).toBeGreaterThan(target!.width * 1.5); // full width now

  // Same terminals, carried along — not rebuilt.
  await expect(panes.nth(0).locator('.xterm-host[data-probe="alive-0"]')).toHaveCount(1);
  await expect(panes.nth(1).locator('.xterm-host[data-probe="alive-1"]')).toHaveCount(1);
  await expect(rows(0)).toContainText('DOCK_PROBE_0');
  await expect(rows(1)).toContainText('DOCK_PROBE_1');
  await expect(win.getByRole('status').filter({ hasText: 'History restored.' })).toHaveCount(0);

  await app.close();
});

// The narrow band along the OUTER edge of the whole layout docks a pane across
// the full width/height — the one placement docking onto a single pane can't
// produce. Grid of three (left | right-top / right-bottom): the left pane goes
// to the bottom and spans the whole width afterwards.
test('dropping into the outer edge band docks a pane across the full width', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();
  const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

  await win.getByText('2 side by side').click();
  const panes = win.locator('.pane');
  await expect(panes).toHaveCount(2);
  await waitForShellPrompt(win, 1);
  await panes.nth(1).locator('.xterm-screen').click();
  await win.keyboard.press(`${MOD}+Shift+D`); // right pane: split top/bottom
  await expect(panes).toHaveCount(3);
  await waitForShellPrompt(win, 2);

  const leftId = await panes.nth(0).getAttribute('data-pane-id');
  const header = await panes.nth(0).locator('.pane-header').boundingBox();
  const ws = await win.locator('.ws-host:visible').boundingBox();
  const bottomRight = await panes.nth(2).boundingBox();
  await win.mouse.move(header!.x + header!.width / 3, header!.y + header!.height / 2);
  await win.mouse.down();
  await win.mouse.move(header!.x + header!.width / 3 + 20, header!.y + header!.height / 2 + 5, { steps: 5 });
  const edgeX = bottomRight!.x + bottomRight!.width / 2;
  const edgeY = ws!.y + ws!.height - 8;
  await win.mouse.move(edgeX, edgeY, { steps: 12 });
  // The synthetic drag session lags one move behind (the last step of a move
  // does not arrive as dragover yet). A real mouse keeps sending motion; two
  // nudges at the target do the same here.
  await win.mouse.move(edgeX + 1, edgeY);
  await win.mouse.move(edgeX, edgeY);

  await expect(win.locator('.layout-edge-preview.dock-bottom')).toHaveCount(1);
  await expect(win.locator('.layout-edge-preview')).toContainText('Bottom, full width');
  await expect(win.locator('.pane-dock-preview')).toHaveCount(0);
  await win.mouse.up();
  await expect(win.locator('.layout-edge-preview')).toHaveCount(0);

  // The moved pane is now last in order and as wide as the whole workspace.
  await expect(panes.nth(2)).toHaveAttribute('data-pane-id', leftId!);
  await expect.poll(async () => Math.round((await panes.nth(2).boundingBox())!.width))
    .toBeGreaterThan(ws!.width - 4);

  // Keyboard counterpart: move the focused pane back up one step.
  await panes.nth(2).locator('.xterm-screen').click();
  await win.keyboard.press(`${MOD}+Alt+Shift+ArrowUp`);
  await expect(panes.nth(1)).toHaveAttribute('data-pane-id', leftId!);
  await expect(panes.nth(1)).toHaveClass(/focused/);

  await app.close();
});
