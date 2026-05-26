import { app, ipcMain, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateEvent } from '../shared/types';

const { autoUpdater } = electronUpdater;

/**
 * Wire electron-updater to the renderer. Updates only work in the packaged,
 * code-signed app published to GitHub Releases; in dev we report 'disabled'.
 *
 * Flow: renderer triggers `updates:check` on startup (and from Settings). When an
 * update is available the user clicks to download; once downloaded we install
 * immediately (relaunch) so it's a single "download & install" action.
 */
export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  const enabled = app.isPackaged;
  const send = (e: UpdateEvent) => getWindow()?.webContents.send('updates:event', e);
  const errMessage = (err: unknown): string =>
    (err instanceof Error ? err.message : String(err)) || 'Unknown error';

  autoUpdater.autoDownload = false;        // wait for the user to click
  autoUpdater.autoInstallOnAppQuit = true; // safety net if not installed eagerly

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ type: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ type: 'not-available' }));
  autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: info.version });
    autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => send({ type: 'error', message: errMessage(err) }));

  ipcMain.on('updates:check', () => {
    if (!enabled) { send({ type: 'disabled' }); return; }
    autoUpdater.checkForUpdates().catch((err) => send({ type: 'error', message: errMessage(err) }));
  });
  ipcMain.on('updates:download', () => {
    if (!enabled) return;
    autoUpdater.downloadUpdate().catch((err) => send({ type: 'error', message: errMessage(err) }));
  });
  ipcMain.on('updates:install', () => {
    if (enabled) autoUpdater.quitAndInstall();
  });
}
