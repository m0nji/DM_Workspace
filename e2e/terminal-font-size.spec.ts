import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { paneBufferText, waitForShellPrompt, waitForScrollbackOnDisk } from './wait-helpers';

test('font size applies live without restarting the shell and survives an app restart', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'dmws-font-'));
  const launch = () => electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1', DMWS_USERDATA: userData }
  });
  const app = await launch();
  try {
    const win = await app.firstWindow();
    await win.getByRole('button', { name: '1 Pane', exact: true }).click();
    await waitForShellPrompt(win);
    await win.locator('.xterm-screen').click();
    await win.keyboard.type(process.platform === 'win32' ? '$dmwsFontProbe = 7381' : 'dmwsFontProbe=7381');
    await win.keyboard.press('Enter');
    // Open appearance settings through the public shortcut, then use the slider.
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
    const size = win.getByRole('slider', { name: 'Terminal font size', exact: true });
    await expect(size).toHaveValue('13');
    await size.focus();
    for (let i = 0; i < 5; i++) await win.keyboard.press('ArrowRight');
    await expect(size).toHaveValue('18');
    await win.screenshot({ path: join(tmpdir(), 'dmws-ux-font-size.png') });
    await win.locator('.settings-modal').getByTitle('Close', { exact: true }).click();
    await expect.poll(() => win.locator('.xterm-rows').evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');
    await win.locator('.xterm-screen').click();
    await win.keyboard.type(process.platform === 'win32' ? 'echo "FONT_LIVE_$dmwsFontProbe"' : 'echo FONT_LIVE_$dmwsFontProbe');
    await win.keyboard.press('Enter');
    await expect.poll(() => paneBufferText(win)).toContain('FONT_LIVE_7381');
    await waitForScrollbackOnDisk(userData, 'FONT_LIVE_7381');
    await expect.poll(() => JSON.parse(readFileSync(join(userData, 'state.json'), 'utf8')).settings.terminalFontSize).toBe(18);
  } finally { await app.close(); }
  const restarted = await launch();
  try {
    const win = await restarted.firstWindow();
    await expect.poll(() => win.locator('.xterm-rows').evaluate((el) => getComputedStyle(el).fontSize)).toBe('18px');
    await expect(win.getByRole('status')).toContainText('History restored. This is a new shell');
    await win.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await expect(win.getByText('History restored.', { exact: false })).not.toBeVisible();
  } finally { await restarted.close(); }
});
