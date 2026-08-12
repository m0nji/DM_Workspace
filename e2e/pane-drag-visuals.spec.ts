import { test, expect, _electron as electron } from '@playwright/test';
import { waitForShellPrompt } from './wait-helpers';

// The drag feedback is CSS driven by three mutually exclusive roles the Pane
// component hands out while a drag runs (drag-source / drop-target /
// drag-bystander). None of it can be checked in vitest: the roles only exist
// during a real HTML5 drag, which needs a browser and native mouse events.
//
// What this spec pins down is the WIRING — which pane gets which role, and that
// every role is gone afterwards. How it looks is judged from screenshots.
test('a pane drag marks source, target and bystanders, and cleans up after itself', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('4 (2×2)').click();
  await expect(win.locator('.pane')).toHaveCount(4);
  await waitForShellPrompt(win, 0);

  const panes = win.locator('.pane');
  const header = await panes.nth(0).locator('.pane-header').boundingBox();
  const centre = async (i: number) => {
    const box = await panes.nth(i).boundingBox();
    return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  };

  // Nothing is marked before the drag starts.
  await expect(win.locator('.pane.drag-source, .pane.drop-target, .pane.drag-bystander'))
    .toHaveCount(0);

  // Raw mouse events, as in pane-swap-keeps-terminal: the intermediate moves are
  // what turns the press into a native drag the component actually listens for.
  await win.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
  await win.mouse.down();
  await win.mouse.move(header!.x + header!.width / 2 + 20, header!.y + header!.height / 2 + 5,
    { steps: 5 });

  // Grabbed pane is the source; the three it left behind step back.
  await expect(panes.nth(0)).toHaveClass(/drag-source/);
  await expect(win.locator('.pane.drag-bystander')).toHaveCount(3);
  await expect(win.locator('.pane.drop-target')).toHaveCount(0);

  // Hovering a foreign pane promotes it from bystander to target, and the hint
  // names the pane being dragged.
  const target = await centre(3);
  await win.mouse.move(target.x, target.y, { steps: 12 });
  await expect(panes.nth(3)).toHaveClass(/drop-target/);
  await expect(panes.nth(3)).not.toHaveClass(/drag-bystander/);
  await expect(win.locator('.pane-drop-hint')).toHaveCount(1);
  await expect(win.locator('.pane-drop-hint')).toContainText('Swap with');
  await expect(win.locator('.pane.drag-bystander')).toHaveCount(2);

  // Back over the grabbed pane itself: dropping there is a no-op, so it must not
  // advertise itself as a target. It stays the source and nothing else lights up.
  const own = await centre(0);
  await win.mouse.move(own.x, own.y, { steps: 12 });
  await expect(win.locator('.pane.drop-target')).toHaveCount(0);
  await expect(win.locator('.pane-drop-hint')).toHaveCount(0);
  await expect(panes.nth(0)).toHaveClass(/drag-source/);
  await expect(panes.nth(0)).not.toHaveClass(/drag-bystander/);

  // Abort with Escape rather than dropping — dragend fires either way, and a
  // cancelled drag is exactly where a stuck highlight would show up.
  await win.keyboard.press('Escape');
  await win.mouse.up();

  await expect(win.locator('.pane.drag-source, .pane.drop-target, .pane.drag-bystander'))
    .toHaveCount(0);
  await expect(win.locator('.pane-drop-hint')).toHaveCount(0);
  await expect(win.locator('.pane')).toHaveCount(4);

  await app.close();
});
