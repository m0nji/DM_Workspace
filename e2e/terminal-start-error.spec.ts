import { test, expect, _electron as electron } from '@playwright/test';
import { paneBufferText, waitForShellPrompt } from './wait-helpers';
import type { useStore } from '../src/renderer/store';

test('failed shell start is visible and retry preserves the one-shot startup command', async () => {
  test.skip(process.platform === 'win32', 'Uses the POSIX SHELL environment to reproduce a missing executable');
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1', SHELL: '/missing/dmws-shell' }
  });
  try {
    const win = await app.firstWindow();
    await win.getByText('1 Pane', { exact: true }).click();
    const error = win.getByRole('alert').filter({ hasText: 'Terminal could not start' });
    await expect(error).toBeVisible();
    const paneId = await win.evaluate(() => {
      const store = (window as unknown as { __store: typeof useStore }).__store;
      const ws = store.getState().activeWorkspace()!;
      const id = ws.layout!.id;
      store.setState({ workspaces: [{ ...ws, pendingStartupCommands: { [id]: 'echo RETRY_STARTUP_739' } }] });
      return id;
    });
    // Retry while the cause still exists must stay recoverable and keep the command.
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(error).toBeVisible();
    await expect.poll(() => win.evaluate((id) => {
      const store = (window as unknown as { __store: typeof useStore }).__store;
      return store.getState().activeWorkspace()?.pendingStartupCommands?.[id];
    }, paneId)).toBe('echo RETRY_STARTUP_739');
    await app.evaluate(() => { process.env.SHELL = '/bin/zsh'; });
    await error.getByRole('button', { name: 'Try again' }).click();
    await expect(error).not.toBeVisible();
    await expect.poll(() => paneBufferText(win)).toContain('RETRY_STARTUP_739');
    await expect.poll(() => win.evaluate((id) => {
      const store = (window as unknown as { __store: typeof useStore }).__store;
      return store.getState().activeWorkspace()?.pendingStartupCommands?.[id];
    }, paneId)).toBeUndefined();
  } finally { await app.close(); }
});

test('a terminated local shell can be restarted in the same pane', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  try {
    const win = await app.firstWindow();
    await win.getByRole('button', { name: '1 Pane', exact: true }).click();
    await waitForShellPrompt(win);
    await win.locator('.xterm-screen').click();
    await win.keyboard.type('exit');
    await win.keyboard.press('Enter');
    await expect(win.getByRole('status')).toContainText('Process exited');
    await win.getByRole('button', { name: 'Start new shell', exact: true }).click();
    await expect(win.getByRole('button', { name: 'Start new shell', exact: true })).not.toBeVisible();
    await win.locator('.xterm-screen').click();
    await win.keyboard.type('echo AFTER_RESTART_192');
    await win.keyboard.press('Enter');
    await expect.poll(() => paneBufferText(win)).toContain('AFTER_RESTART_192');
    await expect(win.locator('.pane')).toHaveCount(1);
  } finally { await app.close(); }
});

test('closing a pane while history is loading does not start a hidden process later', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  try {
    const win = await app.firstWindow();
    // Hold the disk-read boundary and count actual spawn IPCs. No production
    // hooks or fake renderer logic: the real TerminalView owns cancellation.
    await app.evaluate(({ ipcMain }) => {
      const probe = globalThis as unknown as { releaseHistory?: () => void; spawnCount: number };
      probe.spawnCount = 0;
      ipcMain.removeHandler('scrollback:get');
      ipcMain.handle('scrollback:get', () => new Promise((resolve) => {
        probe.releaseHistory = () => resolve(null);
      }));
      ipcMain.removeHandler('pty:spawn');
      ipcMain.handle('pty:spawn', () => { probe.spawnCount++; });
    });
    await win.getByRole('button', { name: '1 Pane', exact: true }).click();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as unknown as { releaseHistory?: () => void }).releaseHistory)).toBe('function');
    await win.locator('.pane').getByTitle('Close', { exact: true }).click();
    await win.getByRole('alertdialog').getByRole('button', { name: 'Close window', exact: true }).click();
    await expect(win.locator('.pane')).toHaveCount(0);
    await app.evaluate(() => (globalThis as unknown as { releaseHistory: () => void }).releaseHistory());
    // Allow the IPC reply and renderer promise callbacks to run before observing.
    await win.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await app.evaluate(() => (globalThis as unknown as { spawnCount: number }).spawnCount)).toBe(0);
  } finally { await app.close(); }
});
