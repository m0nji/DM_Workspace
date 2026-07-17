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

  // Regression: top-tab edit/close actions used to be absolutely positioned
  // over the end of the workspace name. They must occupy their own flex space
  // on hover, with no tab-size jump and no overlap on macOS or Windows.
  const tab = win.locator('.workspace-tab.active');
  const before = await tab.boundingBox();
  await tab.hover();
  const name = await tab.locator('.name').boundingBox();
  const actions = await tab.locator('.ws-actions').boundingBox();
  const after = await tab.boundingBox();
  expect(before).not.toBeNull();
  expect(name).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBeCloseTo(before!.width, 1);
  expect(actions!.x).toBeGreaterThanOrEqual(name!.x + name!.width - 0.5);

  await app.close();
});
