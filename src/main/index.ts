import { app, BrowserWindow, nativeTheme, screen } from 'electron';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { registerIpc } from './ipc';
import { isBoundsVisible } from './window-bounds';
import { registerUpdater } from './updater';
import { installAppMenu } from './menu';
import { windowIconFile } from './window-icon';

// Required so Windows shows the app name/icon on notification toasts.
app.setAppUserModelId('de.dmworkspace.app');

function isAllowedPreviewUrl(raw: string): boolean {
  try {
    const { protocol } = new URL(raw);
    return protocol === 'file:' || protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function isTrustedRendererNavigation(raw: string, rendererUrl: string, devServerUrl: string | undefined): boolean {
  try {
    const next = new URL(raw);
    if (devServerUrl) return next.origin === new URL(devServerUrl).origin;
    return raw === rendererUrl || raw.startsWith(`${rendererUrl}#`);
  } catch {
    return false;
  }
}

// The preview panel uses a <webview> to show HTML files / URLs the user clicked.
// Strip every privilege from attached webviews: no preload, no Node access, fully
// sandboxed and context-isolated, so untrusted page content can't reach the host.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // A file dropped anywhere on the window must never navigate the app to that
  // file (Electron's default). Our drop handlers preventDefault, but this is the
  // safety net for a drop that lands outside them.
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://') && !url.startsWith(contents.getURL())) event.preventDefault();
  });

  contents.on('will-attach-webview', (event, webPreferences, params) => {
    if (!isAllowedPreviewUrl(params.src)) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    webPreferences.allowRunningInsecureContent = false;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
  });
});

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
  const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'];
  const rendererFile = join(__dirname, '../renderer/index.html');
  const rendererUrl = pathToFileURL(rendererFile).toString();
  // Keep the window chrome dark on Windows (title bar, native menus) and make the
  // Windows 11 acrylic backdrop use its dark tint regardless of the system theme.
  if (isWin) nativeTheme.themeSource = 'dark';
  // Packaged builds bundle the icons as extraResources (see package.json); in dev
  // they live in the repo's build/ dir. The installer's win.icon doesn't cover the
  // in-window title-bar icon, so set it explicitly. Linux gets the PNG, Windows the
  // .ico (macOS uses the bundle icon).
  const iconFile = windowIconFile(process.platform);
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, iconFile)
    : join(__dirname, '../../build', iconFile);
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
      sandbox: true,
      webviewTag: true,
    }
  });

  mainWindow.once('ready-to-show', () => {
    if (saved?.isMaximized) mainWindow?.maximize();
    mainWindow?.show();
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererNavigation(url, rendererUrl, devServerUrl)) event.preventDefault();
  });

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(rendererFile);
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
  // On macOS the app stays alive when all windows close, so just tear the
  // terminals down. Elsewhere quitting routes pty cleanup through 'before-quit'.
  if (process.platform === 'darwin') {
    ipc.pty.killAll();
  } else {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Quit only after every pty has actually exited. node-pty's exit callback can
// otherwise fire while Electron is tearing down the JS environment, making the
// native addon abort() the process (the "quit unexpectedly" dialog seen on
// auto-update). preventDefault holds the quit, then we re-quit once cleanup is
// done (or a short timeout elapses) — Squirrel's installer just waits a beat.
let ptyCleanupDone = false;
let ptyCleanupStarted = false;
app.on('before-quit', (event) => {
  if (ptyCleanupDone) return;
  event.preventDefault();
  if (ptyCleanupStarted) return;
  ptyCleanupStarted = true;
  ipc.pty.killAllAndWait().then(() => {
    // E2E only: remove the temporary userData dir created for test isolation
    if (e2eTempDir) {
      rmSync(e2eTempDir, { recursive: true, force: true });
      e2eTempDir = null;
    }
    ptyCleanupDone = true;
    app.quit();
  });
});
