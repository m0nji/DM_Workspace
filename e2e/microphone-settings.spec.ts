import { test, expect, _electron as electron } from '@playwright/test';

test('microphone settings call the native permission API through the trusted preload', async () => {
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    // Reading status never opens a consent dialog or activates the microphone.
    const status = await win.evaluate(() => window.api.microphoneAccess('status'));
    expect(['not-determined', 'granted', 'denied', 'restricted', 'unknown', 'unsupported']).toContain(status);
    await expect(win.evaluate(() => window.api.microphoneAccess('invalid' as 'status'))).rejects.toThrow('Invalid microphone action');
    await win.evaluate(() => { window.__store.getState().setSettingsOpen(true, 'agents'); });
    await expect(win.getByText('Microphone for voice input', { exact: true })).toBeVisible();
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const check = win.getByRole('button', { name: 'Check microphone access', exact: true });
      await expect(check).toBeEnabled();
      await check.click();
      await expect(check).toBeEnabled();
      if (process.platform === 'win32') {
        await expect(win.getByText(/Let desktop apps access your microphone/)).toBeVisible();
        await expect(win.getByRole('button', { name: 'Allow microphone access', exact: true })).toHaveCount(0);
      }
    } else {
      await expect(win.getByText('Permission checks are unavailable on this operating system.', { exact: true })).toBeVisible();
    }
  } finally { await app.close(); }
});
