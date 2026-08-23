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
import { isAllowedPreviewUrl } from '../shared/link-detect';
import { installPermissionGuards } from './permissions';
import { promptNonce } from './prompt-nonce';
import { PROMPT_NONCE_FLAG } from '../shared/prompt-nonce';

// Required so Windows shows the app name/icon on notification toasts.
app.setAppUserModelId('de.dmworkspace.app');

// Last-resort crash guard, armed before anything else can throw.
//
// Electron's default for an uncaught main-process exception is to show the "A
// JavaScript error occurred in the main process" dialog and terminate — which in
// this app kills every running shell (builds, agents, ssh sessions) with no way
// to recover them. Most single-shot IPC listeners (`ipcMain.on`) are one bad
// payload away from that: unlike `ipcMain.handle`, a throw there is NOT captured
// into a rejected promise. Nothing above the individual handler is load-bearing,
// so logging and staying alive is strictly better than taking the sessions down.
// Individual subsystems still handle their own expected failures (see
// task-watcher.ts); this only catches what they miss.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught exception (kept alive to preserve terminal sessions):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[main] unhandled rejection:', reason);
});

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

  // Refuse every browser permission on this contents' session (see
  // permissions.ts). Installed here rather than once on defaultSession so a
  // webview on its own partition is covered too; re-installing is idempotent.
  installPermissionGuards(contents.session);

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
    backgroundColor: isMac ? '#00000000' : '#090908',
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    maximizable: true,
    // Hide the native menu bar on Windows/Linux (Alt still reveals it); macOS
    // keeps its global menu bar. Avoids the stray File/Edit/View bar in-window.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer must know this launch's prompt nonce to tell the local
      // shell hook's marker from one a program printed (see prompt-nonce.ts).
      // Passed as a launch argument because the preload runs sandboxed and
      // cannot import main-process modules.
      additionalArguments: [`${PROMPT_NONCE_FLAG}${promptNonce()}`],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
    }
  });

  // Maximieren MUSS vor dem Laden passieren, nicht erst in 'ready-to-show'.
  // Sonst layoutet der Renderer zuerst auf der (kleineren) Normalgröße: die
  // Panes fitten schmal, spawnen ihr PTY schmal, die Shell druckt dort ihren
  // ersten Prompt — und erst danach springt das Fenster auf Monitorbreite.
  // PowerShells PSReadLine 2.0.0 rechnet bei jeder Konsolengrößenänderung
  // `_initialX = _initialX % BufferWidth`; war das PTY dabei schmaler als der
  // Prompt lang ist, zeichnet es die Eingabe fortan mitten in den Prompt.
  // Siehe docs/superpowers/plans/2026-08-22-psreadline-initialx-fix.md.
  //
  // maximize() zeigt ein verstecktes Fenster (ShowWindow(SW_MAXIMIZE)), also
  // direkt wieder verstecken — Anzeige bleibt Sache von 'ready-to-show'.
  // getNormalBounds() überlebt das unverändert, die gespeicherte Normalgröße
  // geht also nicht verloren.
  if (saved?.isMaximized) {
    mainWindow.maximize();
    mainWindow.hide();
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererNavigation(url, rendererUrl, devServerUrl)) event.preventDefault();
  });

  // Beide load*-Aufrufe geben ein Promise zurück, das bei einem Ladefehler
  // rejectet (Dev-Server nicht erreichbar, abgebrochene Navigation). Unbehandelt
  // wäre das ein stiller Rejection auf ein leeres Fenster — protokollieren, damit
  // der Grund sichtbar ist.
  const load = devServerUrl ? mainWindow.loadURL(devServerUrl) : mainWindow.loadFile(rendererFile);
  load.catch((err: unknown) => console.error('[main] renderer failed to load:', err));

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  mainWindow.on('closed', () => {
    if (boundsTimer) { clearTimeout(boundsTimer); boundsTimer = null; }
    mainWindow = null;
  });
  mainWindow.on('focus', () => mainWindow?.webContents.send('window:focus', true));
  mainWindow.on('blur', () => mainWindow?.webContents.send('window:focus', false));

  // Ctrl+mousewheel zoom: Electron only emits zoom-changed for the gesture, it
  // doesn't change the zoom itself. Step and clamp mirror the menu's zoomIn/
  // zoomOut roles (±0.5 zoom level, 0.5..3x factor ≈ levels -3.8..6).
  mainWindow.webContents.on('zoom-changed', (_event, direction) => {
    const wc = mainWindow?.webContents;
    if (!wc) return;
    const next = wc.getZoomLevel() + (direction === 'in' ? 0.5 : -0.5);
    wc.setZoomLevel(Math.max(-3.8, Math.min(6, next)));
  });

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

void app.whenReady().then(() => {
  installAppMenu();
  createWindow();
});

// Single coordinated pty teardown shared by both quit paths. Memoized while it's
// in flight so concurrent callers await the SAME cleanup, then re-armed once it
// settles (a macOS window can be reopened and spawn fresh ptys). This is what
// makes auto-update safe: quitAndInstall() closes every window FIRST (firing
// window-all-closed) and only THEN calls app.quit() — so before-quit must wait
// on the teardown the window-close already started. The old code used a
// fire-and-forget killAll() here that emptied the pty map, turning before-quit's
// killAllAndWait into a no-op and letting Electron tear the JS env down while
// node-pty's native exit callbacks were still firing — the abort() that surfaced
// as the "quit unexpectedly" dialog. See pty-shutdown.ts for the addon detail.
let ptyTeardown: Promise<void> | null = null;
function teardownPtys(): Promise<void> {
  if (!ptyTeardown) {
    ptyTeardown = ipc.pty.killAllAndWait().finally(() => {
      ptyTeardown = null;
    });
  }
  return ptyTeardown;
}

app.on('window-all-closed', () => {
  // On macOS the app stays alive when all windows close, so just tear the
  // terminals down (safely, awaiting their exit). Elsewhere this means quit —
  // app.quit() routes the same teardown through 'before-quit'.
  void teardownPtys();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Quit only after every pty has actually exited. preventDefault holds the quit,
// then we re-quit once the (possibly already-running) teardown completes.
let ptyCleanupDone = false;
app.on('before-quit', (event) => {
  if (ptyCleanupDone) return;
  event.preventDefault();
  void teardownPtys().then(() => {
    // E2E only: remove the temporary userData dir created for test isolation.
    // Best-effort: on Windows Chromium still holds files in the live profile
    // open at this point, so rmSync throws EPERM — and an uncaught throw here
    // would skip the re-quit below and hang the app forever. The Playwright
    // global teardown sweeps leftover dmws-e2e-* dirs anyway.
    if (e2eTempDir) {
      try {
        rmSync(e2eTempDir, { recursive: true, force: true });
      } catch {
        // Locked profile (Windows) — leave it for the e2e global teardown.
      }
      e2eTempDir = null;
    }
    ptyCleanupDone = true;
    app.quit();
  });
});
