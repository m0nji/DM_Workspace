import { test, expect, _electron as electron } from '@playwright/test';

test('switches workspace navigation to top tabs from appearance settings', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByTitle('Settings').click();
  await expect(win.getByText('Workspace navigation')).toBeVisible();
  await win.getByRole('button', { name: 'Top tabs' }).click();
  await win.locator('.modal-close').click();

  await expect(win.locator('.workspace-tabs')).toBeVisible();
  await expect(win.locator('.sidebar')).toHaveCount(0);
  await expect(win.locator('.workspace-tab.active').getByText('Workspace 1')).toBeVisible();

  await app.close();
});
