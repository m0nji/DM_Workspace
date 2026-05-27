import { ipcMain, BrowserWindow, dialog, app, Notification, clipboard } from 'electron';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'path';
import { PtyManager } from './pty-manager';
import { loadStateFromFile, saveStateToFile } from './persistence';
import { ScrollbackStore } from './scrollback';
import { collectPaneIds } from '../shared/layout-tree';
import { currentWindowBounds } from './window-bounds';
import { candidateBases } from '../shared/link-detect';
import type {
  AppState, PtySpawnRequest, PtyInputRequest, PtyResizeRequest, PtyDataEvent, PtyExitEvent, AgentDonePayload, WindowBounds
} from '../shared/types';

const STATE_FILE = () => join(app.getPath('userData'), 'state.json');
const SCROLLBACK_FILE = () => join(app.getPath('userData'), 'scrollback.json');

// Resolve a relative link target by trying, in order: the pane cwd, each direct
// subdir of the cwd, then known workspace roots. Returns the first base where
// base/rel exists as a file, else null. Extracted from the IPC handler so it is
// testable without Electron.
export function resolveLinkPath(rel: string, cwd: string, roots: string[]): string | null {
  let subdirs: string[] = [];
  try {
    subdirs = readdirSync(cwd, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
      .map((d) => d.name);
  } catch {
    // cwd unreadable → still try cwd-join and roots
  }
  for (const base of candidateBases(cwd, subdirs, roots)) {
    const p = join(base, rel);
    try {
      if (statSync(p).isFile()) return p;
    } catch {
      // not present at this base → try next
    }
  }
  return null;
}

export function registerIpc(getWindow: () => BrowserWindow | null) {
  const pty = new PtyManager();
  const scrollback = new ScrollbackStore(SCROLLBACK_FILE());

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
  ipcMain.handle('state:save', (_e, state: AppState) => {
    const win = getWindow();
    if (win) state.windowBounds = currentWindowBounds(win);
    saveStateToFile(STATE_FILE(), state);
    // Drop scrollback for panes that no longer exist in any layout (closed panes).
    const liveIds = state.workspaces.flatMap((w) => collectPaneIds(w.layout));
    scrollback.prune(liveIds);
  });

  ipcMain.handle('scrollback:get', (_e, paneId: string) => scrollback.get(paneId) ?? null);
  ipcMain.on('scrollback:save', (_e, req: { paneId: string; data: string }) =>
    scrollback.set(req.paneId, req.data)
  );

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(text));

  // Used by the markdown preview panel. The path comes from a link the user
  // clicked in terminal output, so restrict reads to text/markdown files — the
  // panel never needs anything else, and this avoids slurping arbitrary files
  // (e.g. a malicious agent printing a clickable ~/.ssh/id_rsa path).
  ipcMain.handle('file:read', (_e, path: string): string => {
    if (!/\.(md|markdown|mdx|txt)$/i.test(path)) {
      throw new Error('file:read is restricted to text/markdown files');
    }
    return readFileSync(path, 'utf8');
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    const win = getWindow();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('link:resolve', (_e, req: { rel: string; cwd: string; roots: string[] }): string | null =>
    resolveLinkPath(req.rel, req.cwd, req.roots)
  );

  ipcMain.on('notify:agentDone', (_e, payload: AgentDonePayload) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: payload.workspaceName,
      body: `A terminal is ready: ${payload.paneTitle}`
    });
    n.on('click', () => {
      const win = getWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
        win.webContents.send('notify:activateWorkspace', payload.workspaceId);
      }
    });
    n.show();
  });

  // Read-modify-write only the windowBounds field so a bounds update never races
  // away the renderer-owned parts of the state (and vice versa).
  function persistWindowBounds(win: BrowserWindow): void {
    const state = loadStateFromFile(STATE_FILE());
    state.windowBounds = currentWindowBounds(win);
    saveStateToFile(STATE_FILE(), state);
  }

  function loadWindowBounds(): WindowBounds | undefined {
    return loadStateFromFile(STATE_FILE()).windowBounds;
  }

  return { pty, persistWindowBounds, loadWindowBounds };
}
