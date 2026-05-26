import { ipcMain, BrowserWindow, dialog, app } from 'electron';
import { join } from 'path';
import { PtyManager } from './pty-manager';
import { loadStateFromFile, saveStateToFile } from './persistence';
import type {
  AppState, PtySpawnRequest, PtyInputRequest, PtyResizeRequest, PtyDataEvent, PtyExitEvent
} from '../shared/types';

const STATE_FILE = () => join(app.getPath('userData'), 'state.json');

export function registerIpc(getWindow: () => BrowserWindow | null): PtyManager {
  const pty = new PtyManager();

  pty.onData((paneId, data) => {
    const payload: PtyDataEvent = { paneId, data };
    getWindow()?.webContents.send('pty:data', payload);
  });
  pty.onExit((paneId, exitCode) => {
    const payload: PtyExitEvent = { paneId, exitCode };
    getWindow()?.webContents.send('pty:exit', payload);
  });

  ipcMain.handle('pty:spawn', (_e, req: PtySpawnRequest) => {
    pty.spawn(req.paneId, { cwd: req.cwd, cols: req.cols, rows: req.rows });
  });
  ipcMain.on('pty:input', (_e, req: PtyInputRequest) => pty.write(req.paneId, req.data));
  ipcMain.on('pty:resize', (_e, req: PtyResizeRequest) => pty.resize(req.paneId, req.cols, req.rows));
  ipcMain.on('pty:kill', (_e, paneId: string) => pty.kill(paneId));

  ipcMain.handle('state:load', (): AppState => loadStateFromFile(STATE_FILE()));
  ipcMain.handle('state:save', (_e, state: AppState) => saveStateToFile(STATE_FILE(), state));

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = getWindow();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  return pty;
}
