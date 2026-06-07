import { test, expect, _electron as electron } from '@playwright/test';

test('context menu has Clear Window / Clear All Windows with confirmation', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();
  await win.getByText('4 (2×2)').click();
  await expect(win.locator('.pane')).toHaveCount(4);
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();

  // Right-click the first terminal to open the context menu.
  await win.locator('.xterm-host-wrap').first().click({ button: 'right' });

  // Both new items are present.
  await expect(win.locator('.context-menu-item', { hasText: 'Clear Window' })).toBeVisible();
  await expect(win.locator('.context-menu-item', { hasText: 'Clear All Windows' })).toBeVisible();

  // "Clear Window" closes the menu without a confirmation.
  await win.locator('.context-menu-item', { hasText: 'Clear Window' }).click();
  await expect(win.locator('.context-menu')).toHaveCount(0);
  await expect(win.locator('.confirm-modal')).toHaveCount(0);

  // "Clear All Windows" asks for confirmation first.
  await win.locator('.xterm-host-wrap').first().click({ button: 'right' });
  await win.locator('.context-menu-item', { hasText: 'Clear All Windows' }).click();
  await expect(win.getByText('Clear all windows?')).toBeVisible();
  await expect(win.locator('.confirm-btn', { hasText: 'Clear all' })).toBeVisible();

  // Cancel leaves the dialog dismissed.
  await win.locator('.confirm-btn', { hasText: 'Cancel' }).click();
  await expect(win.locator('.confirm-modal')).toHaveCount(0);

  // Re-open and confirm — dialog closes, app stays alive with all panes.
  await win.locator('.xterm-host-wrap').first().click({ button: 'right' });
  await win.locator('.context-menu-item', { hasText: 'Clear All Windows' }).click();
  await win.locator('.confirm-btn', { hasText: 'Clear all' }).click();
  await expect(win.locator('.confirm-modal')).toHaveCount(0);
  await expect(win.locator('.pane')).toHaveCount(4);

  await app.close();
});
