import { ipcMain, BrowserWindow, dialog, app, Notification, clipboard } from 'electron';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'path';
import { PtyManager } from './pty-manager';
import { loadStateFromFile, saveStateToFile } from './persistence';
import { ScrollbackStore } from './scrollback';
import { collectPaneIds } from '../shared/layout-tree';
import { currentWindowBounds } from './window-bounds';
import { pathEndsWith } from '../shared/link-detect';
import type {
  AppState, PtySpawnRequest, PtyInputRequest, PtyResizeRequest, PtyDataEvent, PtyExitEvent, AgentDonePayload, WindowBounds
} from '../shared/types';

const STATE_FILE = () => join(app.getPath('userData'), 'state.json');
const SCROLLBACK_FILE = () => join(app.getPath('userData'), 'scrollback.json');

const MAX_DEPTH = 5;   // levels below the start base
const MAX_DIRS = 2000; // total dirs visited before giving up
const SKIP = new Set(['node_modules', '.git']);

// Resolve a relative link target via a bounded breadth-first walk of the file
// tree, starting at the pane cwd and then each known workspace root. Returns the
// first file whose path ends (segment-aligned) with `rel`; BFS yields the
// shallowest match. Skips node_modules/.git/dot dirs and symlinked dirs, and is
// hard-capped by maxDepth/maxDirs. Extracted from the IPC handler so it is
// testable without Electron; opts override the caps for tests.
export function resolveLinkPath(
  rel: string,
  cwd: string,
  roots: string[],
  opts: { maxDepth?: number; maxDirs?: number } = {}
): string | null {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const maxDirs = opts.maxDirs ?? MAX_DIRS;
  const norm = (p: string) => p.replace(/\/+$/, '');
  const starts = [norm(cwd), ...roots.map(norm)];
  // Only skip a nested start if its ancestor completed its BFS WITHOUT hitting
  // the budget cap — if the ancestor was capped, the nested start may not have
  // been reached and must run its own BFS with a fresh budget.
  const fullyWalked: string[] = [];

  for (const start of starts) {
    // Skip starts that are nested under a start that was fully walked (not
    // capped), because the whole subtree was already visited exhaustively.
    if (fullyWalked.some((s) => start === s || start.startsWith(s + '/'))) continue;

    // Each start gets its own fresh budget so a large cwd subtree cannot
    // exhaust the quota before any workspace root is ever searched.
    let visited = 0;
    let capped = false;

    let head = 0;
    const queue: Array<{ dir: string; depth: number }> = [{ dir: start, depth: 0 }];
    while (head < queue.length) {
      if (visited >= maxDirs) { capped = true; break; }
      visited++;
      const { dir, depth } = queue[head++];
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        continue; // unreadable dir -> skip
      }
      // Files first: a match at the current depth beats anything deeper.
      for (const e of entries) {
        const fp = join(dir, e.name);
        if (e.isFile() && pathEndsWith(fp, rel)) return fp;
      }
      if (depth < maxDepth) {
        for (const e of entries) {
          // isDirectory() is false for symlinked dirs (withFileTypes does not
          // follow symlinks), so those are never enqueued.
          if (e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)) {
            queue.push({ dir: join(dir, e.name), depth: depth + 1 });
          }
        }
      }
    }
    if (!capped) fullyWalked.push(start);
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
