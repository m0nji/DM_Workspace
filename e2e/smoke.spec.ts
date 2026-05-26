import { test, expect, _electron as electron } from '@playwright/test';

test('launches, shows welcome, applies a preset', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  // Welcome screen visible
  await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();

  // Apply the "4 (2×2)" preset
  await win.getByText('4 (2×2)').click();

  // Four panes should appear
  await expect(win.locator('.pane')).toHaveCount(4);

  // Confirm a real terminal initialized inside a pane (xterm always renders .xterm-screen)
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();

  await app.close();
});
