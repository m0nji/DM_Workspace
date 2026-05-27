import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { registerIpc } from './ipc';
import { isBoundsVisible } from './window-bounds';
import { registerUpdater } from './updater';
import { installAppMenu } from './menu';

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
  // Restore last-used window size/position. width/height always apply; x/y only
  // if the saved frame still overlaps a connected display (a disconnected monitor
  // would otherwise open the window off-screen) — otherwise the window is centered.
  const saved = ipc.loadWindowBounds();
  const displays = screen.getAllDisplays().map((d) => d.bounds);
  const usePos = saved ? isBoundsVisible(saved, displays) : false;
  mainWindow = new BrowserWindow({
    width: saved?.width ?? 1400,
    height: saved?.height ?? 900,
    ...(usePos ? { x: saved!.x, y: saved!.y } : {}),
    show: false, // shown on ready-to-show to avoid a blank flash during load
    icon: iconPath,
    // macOS keeps the vibrancy frosted backdrop. Windows uses a solid dark base:
    // the acrylic backdrop was too strong, and a transparent backgroundColor also
    // greys out the maximize button, so Windows stays fully opaque and maximizable.
    backgroundColor: isMac ? '#00000000' : '#0d0d0d',
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    maximizable: true,
    // Hide the native menu bar on Windows/Linux (Alt still reveals it); macOS
    // keeps its global menu bar. Avoids the stray File/Edit/View bar in-window.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required so preload can use Node-built IPC bridge
      webviewTag: true,
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (saved?.isMaximized) mainWindow?.maximize();
    mainWindow?.show();
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on('closed', () => {
    if (boundsTimer) { clearTimeout(boundsTimer); boundsTimer = null; }
    mainWindow = null;
  });
  mainWindow.on('focus', () => mainWindow?.webContents.send('window:focus', true));
  mainWindow.on('blur', () => mainWindow?.webContents.send('window:focus', false));

  // Persist size/position shortly after the user stops dragging/resizing, and
  // immediately on (un)maximize. Debounced so a resize drag writes once, not per frame.
  const scheduleBoundsSave = (): void => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      boundsTimer = null;
      if (mainWindow) ipc.persistWindowBounds(mainWindow);
    }, 500);
  };
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('maximize', () => mainWindow && ipc.persistWindowBounds(mainWindow));
  mainWindow.on('unmaximize', () => mainWindow && ipc.persistWindowBounds(mainWindow));
}

const ipc = registerIpc(() => mainWindow);
registerUpdater(() => mainWindow);

app.whenReady().then(() => {
  installAppMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  ipc.pty.killAll();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  ipc.pty.killAll();
  // E2E only: remove the temporary userData dir created for test isolation
  if (e2eTempDir) {
    rmSync(e2eTempDir, { recursive: true, force: true });
    e2eTempDir = null;
  }
});
