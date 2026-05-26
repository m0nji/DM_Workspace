import { app, BrowserWindow, nativeTheme } from 'electron';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { registerIpc } from './ipc';
import { registerUpdater } from './updater';

// Required so Windows shows the app name/icon on notification toasts.
app.setAppUserModelId('de.dmworkspace.app');

// E2E isolation: when DMWS_E2E is set, redirect userData to a fresh temp dir
// so each test run starts from defaultState (welcome screen) instead of any
// previously persisted layout. Must run before app.whenReady().
let e2eTempDir: string | null = null;
if (process.env.DMWS_USERDATA) {
  // Explicit userData dir (used by tests that need persistence across restarts).
  // Unlike DMWS_E2E this is NOT removed on quit, so a second launch sees the
  // first launch's state. Never points at the real userData.
  app.setPath('userData', process.env.DMWS_USERDATA);
} else if (process.env.DMWS_E2E) {
  e2eTempDir = mkdtempSync(join(tmpdir(), 'dmws-e2e-'));
  app.setPath('userData', e2eTempDir);
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  // Keep the window chrome dark on Windows (title bar, native menus) and make the
  // Windows 11 acrylic backdrop use its dark tint regardless of the system theme.
  if (isWin) nativeTheme.themeSource = 'dark';
  // Packaged builds bundle the icon as an extraResource (see package.json); in dev
  // it lives in the repo's build/ dir. The installer's win.icon doesn't cover the
  // in-window title-bar icon, so set it explicitly.
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../../build/icon.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: false, // shown on ready-to-show, after the acrylic repaint nudge below
    icon: iconPath,
    // macOS vibrancy and Windows 11 acrylic both reveal a frosted-glass backdrop
    // where the terminals are translucent (terminalOpacity). Both need a fully
    // transparent backgroundColor so the material shows through.
    backgroundColor: isMac || isWin ? '#00000000' : '#0d0d0d',
    vibrancy: isMac ? 'under-window' : undefined,
    backgroundMaterial: isWin ? 'acrylic' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    // Hide the native menu bar on Windows/Linux (Alt still reveals it); macOS
    // keeps its global menu bar. Avoids the stray File/Edit/View bar in-window.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false // required so preload can use Node-built IPC bridge
    }
  });

  mainWindow.once('ready-to-show', () => {
    const win = mainWindow;
    if (!win) return;
    win.show();
    // Windows bug: backgroundMaterial (acrylic) isn't applied on the first paint —
    // it only kicks in after a DWM repaint (which a manual resize triggers). Re-set
    // the material and nudge the height by 1px so the frosted backdrop appears right
    // away instead of only after the user resizes the window.
    if (isWin) {
      win.setBackgroundMaterial('acrylic');
      const b = win.getBounds();
      win.setBounds({ ...b, height: b.height + 1 });
      win.setBounds(b);
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => { mainWindow = null; });
  mainWindow.on('focus', () => mainWindow?.webContents.send('window:focus', true));
  mainWindow.on('blur', () => mainWindow?.webContents.send('window:focus', false));
}

const pty = registerIpc(() => mainWindow);
registerUpdater(() => mainWindow);

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
