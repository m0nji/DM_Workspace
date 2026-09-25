import { test, expect, _electron as electron } from '@playwright/test';

test('context menu has Clear Window / Clear All Windows with confirmation', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
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
  await expect(win.locator('.confirm-btn', { hasText: 'Cancel' })).toBeFocused();
  await win.keyboard.press('Enter');
  await expect(win.locator('.pane').first().getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
  await expect(win.locator('.confirm-modal')).toHaveCount(0);

  // Re-open and confirm — dialog closes, app stays alive with all panes.
  await win.locator('.xterm-host-wrap').first().click({ button: 'right' });
  await win.locator('.context-menu-item', { hasText: 'Clear All Windows' }).click();
  await win.locator('.confirm-btn', { hasText: 'Clear all' }).click();
  await expect(win.locator('.confirm-modal')).toHaveCount(0);
  await expect(win.locator('.pane')).toHaveCount(4);

  await app.close();
});

// Regression (Windows): "Clear Window" only wiped xterm, while ConPTY kept its
// own screen copy with the prompt on its old row. ConPTY positions the cursor
// absolutely when it paints the next keystroke, so typed text landed far below
// the prompt that had moved to the top — and a resize repainted the cleared
// history. At a PowerShell prompt the shell now clears ConPTY's copy itself
// (F23 binding); a half-typed line must survive the clear.
test('typing after Clear Window renders on the prompt line', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();
  const bufferText = () =>
    win.evaluate(() => {
      const texts = (window as unknown as { __bufferText: Map<string, () => string> }).__bufferText;
      return [...texts.values()][0]();
    });
  const nonEmptyLines = async () => (await bufferText()).split('\n').map((l) => l.trimEnd()).filter((l) => l !== '');

  await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();
  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  await expect.poll(async () => (await bufferText()).trim().length).toBeGreaterThan(0);

  // Push the prompt well down the viewport.
  await win.locator('.xterm-host-wrap').click();
  for (let i = 0; i < 8; i++) {
    await win.keyboard.type(`echo line${i}`);
    await win.keyboard.press('Enter');
  }
  await expect.poll(bufferText).toContain('line7\n');
  await win.keyboard.type('TYPED_');
  await expect.poll(bufferText).toContain('TYPED_');

  await win.locator('.xterm-host-wrap').click({ button: 'right' });
  await win.locator('.context-menu-item', { hasText: 'Clear Window' }).click();
  await expect.poll(async () => (await bufferText()).includes('line0')).toBe(false);

  await win.keyboard.type('AFTER_CLEAR');
  await expect.poll(bufferText).toContain('TYPED_AFTER_CLEAR');
  // Give ConPTY time for any late repaint before judging the layout.
  await win.waitForTimeout(500);
  // Only the prompt line is left, typed text on it, at the top.
  const text = await bufferText();
  expect(await nonEmptyLines(), text).toEqual([expect.stringMatching(/^\S.* TYPED_AFTER_CLEAR$/)]);
  expect(text.split('\n')[0], text).toContain('TYPED_AFTER_CLEAR');

  // A resize makes ConPTY repaint from its own buffer — the history must not
  // come back.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const [width, height] = w.getSize();
    w.setSize(width - 200, height - 150);
  });
  await win.waitForTimeout(1500);
  expect(await bufferText()).not.toContain('line0');

  await app.close();
});