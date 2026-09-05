import { test, expect, _electron as electron } from '@playwright/test';

test('asks before closing a pane and only closes after confirmation', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('2 side by side').click();
  await expect(win.locator('.pane')).toHaveCount(2);

  await win.locator('.pane').first().getByTitle('Close').click();
  const dialog = win.getByRole('alertdialog', { name: 'Close window?' });
  await expect(dialog).toBeVisible();
  // A destructive dialog starts on Cancel; Enter must activate that button only.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await win.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Close window' })).toBeFocused();
  await win.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(win.locator('.pane').first().getByTitle('Close')).toBeFocused();
  await expect(win.locator('.pane')).toHaveCount(2);

  await win.locator('.pane').first().getByTitle('Close').click();
  await dialog.getByRole('button', { name: 'Close window' }).click();
  await expect(win.locator('.pane')).toHaveCount(1);

  await app.close();
});


test('opens a layout with the keyboard', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  try {
    const win = await app.firstWindow();
    const preset = win.getByRole('button', { name: '2 side by side', exact: true });
    await preset.focus();
    await win.keyboard.press('Enter');
    await expect(win.locator('.pane')).toHaveCount(2);
  } finally { await app.close(); }
});

test('closing a whole workspace starts on Cancel and Enter preserves its terminals', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  try {
    const win = await app.firstWindow();
    await win.getByRole('button', { name: '2 side by side', exact: true }).click();
    await win.locator('.ws-item').first().hover();
    await win.locator('.ws-item').first().getByTitle('Close workspace', { exact: true }).click();
    const dialog = win.getByRole('alertdialog', { name: 'Close workspace?' });
    await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(dialog).not.toBeVisible();
    await expect(win.locator('.pane')).toHaveCount(2);
  } finally { await app.close(); }
});
