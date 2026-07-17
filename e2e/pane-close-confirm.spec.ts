import { test, expect, _electron as electron } from '@playwright/test';

test('asks before closing a pane and only closes after confirmation', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('2 side by side').click();
  await expect(win.locator('.pane')).toHaveCount(2);

  await win.locator('.pane').first().getByTitle('Close').click();
  const dialog = win.getByRole('alertdialog', { name: 'Close window?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(win.locator('.pane')).toHaveCount(2);

  await win.locator('.pane').first().getByTitle('Close').click();
  await dialog.getByRole('button', { name: 'Close window' }).click();
  await expect(win.locator('.pane')).toHaveCount(1);

  await app.close();
});
