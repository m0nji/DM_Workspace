import { test, expect, _electron as electron } from '@playwright/test';

// Splitting or closing a pane restructures the layout tree. That must MOVE the
// existing terminals, never unmount/remount them: a remount replays the
// serialized scrollback (old-width hard wraps + the session-restore marker)
// underneath the still-running program, which shreds the pane's content — the
// "text tears when a new pane opens beside a running TUI" bug.
test('split and close move the surviving terminal instead of remounting it', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    // DOM renderer so terminal text is readable from .xterm-rows.
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();
  await win.waitForTimeout(1500); // shell prompt

  await win.locator('.pane .xterm-screen').first().click();
  await win.keyboard.type('echo SPLIT_PROBE_4242');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('SPLIT_PROBE_4242');

  // Tag the live terminal's DOM. If the pane remounts, a fresh xterm host is
  // created and the tag disappears.
  await win.evaluate(() => {
    document.querySelector('.pane .xterm-host')!.setAttribute('data-probe', 'alive');
  });

  await win.locator('.pane-btn[title="Split into left & right"]').first().click();
  await expect(win.locator('.pane')).toHaveCount(2);
  await win.waitForTimeout(1200); // restore replay (if any) + refit would land here

  // The original terminal survived the split…
  await expect(win.locator('.pane').first().locator('.xterm-host[data-probe="alive"]')).toHaveCount(1);
  // …and nothing replayed saved scrollback into a live pane.
  await expect(win.locator('.xterm-rows').first()).not.toContainText('wiederhergestellt');
  await expect(win.locator('.xterm-rows').first()).toContainText('SPLIT_PROBE_4242');

  // Closing the new sibling collapses the split node — the survivor must move,
  // not remount, for the same reason.
  await win.locator('.pane').nth(1).getByTitle('Close').click();
  await win.getByRole('alertdialog', { name: 'Close window?' })
    .getByRole('button', { name: 'Close window' }).click();
  await expect(win.locator('.pane')).toHaveCount(1);
  await win.waitForTimeout(1200);

  await expect(win.locator('.pane .xterm-host[data-probe="alive"]')).toHaveCount(1);
  await expect(win.locator('.xterm-rows').first()).not.toContainText('wiederhergestellt');

  await app.close();
});
