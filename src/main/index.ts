import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { registerIpc } from './ipc';

// E2E isolation: when DMWS_E2E is set, redirect userData to a fresh temp dir
// so each test run starts from defaultState (welcome screen) instead of any
// previously persisted layout. Must run before app.whenReady().
let e2eTempDir: string | null = null;
if (process.env.DMWS_E2E) {
  e2eTempDir = mkdtempSync(join(tmpdir(), 'dmws-e2e-'));
  app.setPath('userData', e2eTempDir);
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    // On macOS use a vibrancy (blurred) backdrop so the terminal-transparency
    // setting reveals a frosted-glass effect like the native Terminal app.
    backgroundColor: isMac ? '#00000000' : '#0d0d0d',
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required so preload can use Node-built IPC bridge
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

const pty = registerIpc(() => mainWindow);

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  pty.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  pty.killAll();
  // E2E only: remove the temporary userData dir created for test isolation
  if (e2eTempDir) {
    rmSync(e2eTempDir, { recursive: true, force: true });
    e2eTempDir = null;
  }
});
