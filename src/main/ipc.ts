import { ipcMain, BrowserWindow, dialog, app, Notification, clipboard, shell } from 'electron';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync, statSync, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'path';
import { PtyManager } from './pty-manager';
import { createPtyDataBatcher } from './pty-data-batcher';
import { loadStateFromFile, saveStateToFile } from './persistence';
import { ScrollbackStore } from './scrollback';
import { loadTasks, saveTasks, tasksFilePath } from './task-store';
import { armTaskWatcher } from './task-watcher';
import type { TaskBoard } from '../shared/types';
import { collectPaneIds } from '../shared/layout-tree';
import { currentWindowBounds } from './window-bounds';
import { pathEndsWith } from '../shared/link-detect';
import { readPreviewFile } from './preview-file';
import { readDir, readTextFile, writeTextFile, createFile, FsBrowserError } from './fs-browser';
import { expandTilde } from './resolve-cwd';
import {
  isNonEmptyString, parseAgentDone, parsePtyInput, parsePtyResize, parsePtySpawn,
  parseScrollbackSave, parseTasksSave
} from './ipc-validate';
import type {
  AppState, PtyDataEvent, PtyExitEvent, WindowBounds
} from '../shared/types';

// Ein Payload, der die Prüfung nicht besteht, ist immer ein Bug im Renderer (die
// einzige Gegenstelle) — also protokollieren statt still verwerfen, sonst sucht
// man später eine Pane, die grundlos nicht reagiert. Der Payload selbst wird NICHT
// mitgeloggt: durch pty:input laufen Tastenanschläge, also auch Passwörter.
function rejectPayload(channel: string, raw: unknown): void {
  console.warn(`[ipc] ${channel}: ungültiger Payload verworfen (${typeof raw})`);
}

const STATE_FILE = () => join(app.getPath('userData'), 'state.json');
const SCROLLBACK_FILE = () => join(app.getPath('userData'), 'scrollback.json');
// Pasted clipboard images are dropped here as temp PNGs so we can insert their
// path into the terminal. Wiped on quit — they only need to live for the session.
const IMAGE_TMP_DIR = join(app.getPath('temp'), 'dm-workspace-images');

const MAX_DEPTH = 5;   // levels below the start base
const MAX_DIRS = 2000; // total dirs visited before giving up
const SKIP = new Set(['node_modules', '.git']);

// Linked git worktrees live outside the repo (or under dot-dirs the BFS skips),
// so they can never be reached from the pane cwd or a workspace root alone.
// Derive their paths from git's own metadata (.git/worktrees/*/gitdir) instead
// of spawning git: walk up from `start` to the enclosing repo, resolve a
// worktree ".git" file back to the main checkout, then enumerate all linked
// worktrees. Stale entries point at deleted dirs; the BFS skips those anyway.
export function gitWorktreeStarts(start: string): string[] {
  let dir = expandTilde(start);
  let gitPath: string | null = null;
  for (;;) {
    const cand = join(dir, '.git');
    try { statSync(cand); gitPath = cand; break; } catch { /* keep ascending */ }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!gitPath) return [];

  const out: string[] = [];
  let gitDir = gitPath;
  try {
    if (statSync(gitPath).isFile()) {
      // Worktree checkout: ".git" is a file "gitdir: <main>/.git/worktrees/<name>"
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(gitPath, 'utf8'));
      if (!m) return [];
      gitDir = dirname(dirname(m[1])); // <main>/.git
      out.push(dirname(gitDir));       // main checkout root
    }
  } catch { return []; }
  try {
    for (const name of readdirSync(join(gitDir, 'worktrees'))) {
      try {
        const wtGit = readFileSync(join(gitDir, 'worktrees', name, 'gitdir'), 'utf8').trim();
        if (wtGit) out.push(dirname(wtGit)); // strip trailing "/.git"
      } catch { /* partial metadata -> skip this worktree */ }
    }
  } catch { /* no linked worktrees */ }
  return out;
}

interface ResolveLinkPathOptions {
  maxDepth?: number;
  maxDirs?: number;
  onVisitDir?: (dir: string) => void;
}

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
  opts: ResolveLinkPathOptions = {}
): string | null {
  const maxDepth = opts.maxDepth ?? MAX_DEPTH;
  const maxDirs = opts.maxDirs ?? MAX_DIRS;
  // expandTilde: a workspace cwd may still be the literal '~' (fresh workspace),
  // which readdirSync can't resolve. Trailing-separator strip is [\\/] so the
  // nested-start dedup below also works with Windows paths.
  const norm = (p: string) => expandTilde(p).replace(/[\\/]+$/, '');
  // Worktree-derived starts go last: the primary locations (cwd, workspace
  // roots) keep priority when the same rel exists in both.
  const primary = [norm(cwd), ...roots.map(norm)];
  const starts = [...new Set([...primary, ...primary.flatMap(gitWorktreeStarts).map(norm)])];
  // Separator-agnostic prefix test for the nested-start dedup.
  const fwd = (p: string) => p.replace(/\\/g, '/');
  // Only skip a nested start if its ancestor completed its BFS WITHOUT hitting
  // the budget cap — if the ancestor was capped, the nested start may not have
  // been reached and must run its own BFS with a fresh budget.
  const fullyWalked: string[] = [];

  for (const start of starts) {
    // Skip starts that are nested under a start that was fully walked (not
    // capped), because the whole subtree was already visited exhaustively —
    // unless the path down to the nested start passes through a segment the
    // BFS skips (dot dir, node_modules): that subtree was never visited, e.g.
    // a git worktree under repo/.worktrees/.
    const throughSkipped = (anc: string, s: string) =>
      fwd(s).slice(fwd(anc).length + 1).split('/').some((seg) => seg.startsWith('.') || SKIP.has(seg));
    if (fullyWalked.some((s) => start === s || (fwd(start).startsWith(fwd(s) + '/') && !throughSkipped(s, start)))) continue;

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
      opts.onVisitDir?.(dir);
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
  // state.json wird hier ein zweites Mal gelesen (das erste Mal geschieht über
  // state:load): das erste scrollback:get feuert beim Mount der ersten Pane und
  // damit lange vor dem ersten state:save. Ohne diesen Lesevorgang gäbe es ein
  // Zeitfenster, in dem der Store noch als aktiviert gilt und Verlauf ausliefert,
  // obwohl die Option aus ist.
  const scrollback = new ScrollbackStore(SCROLLBACK_FILE(), {
    enabled: loadStateFromFile(STATE_FILE()).settings.restoreTerminalHistory !== false
  });

  // Wipe the temp image dir on quit; pasted images only need to survive the
  // session. Also release the task watcher and its pending debounce (declared
  // below; the handler runs at quit time, long after they exist).
  app.on('will-quit', () => {
    scrollback.flush();
    taskWatcher?.close();
    if (watchDebounce) clearTimeout(watchDebounce);
    try { rmSync(IMAGE_TMP_DIR, { recursive: true, force: true }); } catch { /* best-effort */ }
  });

  // Coalesce PTY chunks into one IPC message per pane per ~5ms window — see
  // pty-data-batcher.ts for why (IPC saturation under high-throughput output).
  const dataBatcher = createPtyDataBatcher({
    send: (paneId, data) => {
      const payload: PtyDataEvent = { paneId, data };
      getWindow()?.webContents.send('pty:data', payload);
    }
  });
  pty.onData((paneId, data) => dataBatcher.push(paneId, data));
  pty.onExit((paneId, exitCode) => {
    // The exit event must never outrun still-buffered output for this pane.
    dataBatcher.flushPane(paneId);
    const payload: PtyExitEvent = { paneId, exitCode };
    getWindow()?.webContents.send('pty:exit', payload);
  });

  ipcMain.handle('pty:spawn', (_e, raw: unknown) => {
    const req = parsePtySpawn(raw);
    if (!req) { rejectPayload('pty:spawn', raw); return; }
    pty.spawn(req.paneId, { cwd: req.cwd, cols: req.cols, rows: req.rows });
  });
  ipcMain.on('pty:input', (_e, raw: unknown) => {
    const req = parsePtyInput(raw);
    if (!req) { rejectPayload('pty:input', raw); return; }
    pty.write(req.paneId, req.data);
  });
  ipcMain.on('pty:resize', (_e, raw: unknown) => {
    const req = parsePtyResize(raw);
    if (!req) { rejectPayload('pty:resize', raw); return; }
    pty.resize(req.paneId, req.cols, req.rows);
  });
  ipcMain.on('pty:kill', (_e, paneId: unknown) => {
    if (!isNonEmptyString(paneId)) { rejectPayload('pty:kill', paneId); return; }
    pty.kill(paneId);
  });

  ipcMain.handle('state:load', (): AppState => loadStateFromFile(STATE_FILE()));
  ipcMain.handle('state:save', (_e, state: AppState) => {
    const win = getWindow();
    if (win) state.windowBounds = currentWindowBounds(win);
    saveStateToFile(STATE_FILE(), state);
    // Drop scrollback for panes that no longer exist in any layout (closed panes).
    const liveIds = state.workspaces.flatMap((w) => collectPaneIds(w.layout));
    scrollback.prune(liveIds);
    // Der Renderer persistiert Settings ohne Debounce, das Umlegen des Schalters
    // greift hier also im selben Zug.
    scrollback.setEnabled(state.settings.restoreTerminalHistory !== false);
  });

  ipcMain.handle('scrollback:get', (_e, paneId: unknown) =>
    isNonEmptyString(paneId) ? scrollback.get(paneId) ?? null : null
  );
  ipcMain.on('scrollback:save', (_e, raw: unknown) => {
    const req = parseScrollbackSave(raw);
    if (!req) { rejectPayload('scrollback:save', raw); return; }
    scrollback.set(req.paneId, req.data);
  });

  // --- Task board ---------------------------------------------------------
  // Echo-guard: remember the exact content we last wrote per dir so the file
  // watcher ignores our own writes (no save->watch->reload ping-pong). Mirrors the
  // scrollback debounce philosophy. One watcher at a time (the board only ever
  // shows the active workspace's dir).
  const lastWritten = new Map<string, string>();
  let taskWatcher: FSWatcher | null = null;
  let watchedDir: string | null = null;
  let watchDebounce: ReturnType<typeof setTimeout> | null = null;

  const startTaskWatch = (dir: string): void => {
    if (watchedDir === dir && taskWatcher) return;
    taskWatcher?.close();
    taskWatcher = null;
    watchedDir = dir;
    // Only one dir is ever watched; drop echo-guard entries for other dirs so
    // the map cannot grow without bound over a long session.
    for (const key of [...lastWritten.keys()]) if (key !== dir) lastWritten.delete(key);
    const file = tasksFilePath(dir);
    // Watch the .dmworkspace dir (the file may not exist yet); filter on filename.
    // armTaskWatcher owns the error path: a watcher that dies at runtime (EMFILE,
    // folder removed) must not take the main process down — we just lose live
    // reloads until the next tasks:load/save re-arms it.
    taskWatcher = armTaskWatcher(
      dirname(file),
      (name) => {
        if (name && name !== 'TASKS.md') return;
        if (watchDebounce) clearTimeout(watchDebounce);
        watchDebounce = setTimeout(() => {
          let content: string;
          try { content = readFileSync(file, 'utf8'); } catch { content = ''; }
          if (content === lastWritten.get(dir)) return; // our own write
          getWindow()?.webContents.send('tasks:changed', { dir, board: loadTasks(dir) });
        }, 150);
      },
      () => { taskWatcher = null; watchedDir = null; }
    );
    if (!taskWatcher) watchedDir = null; // re-try arming on the next load/save
  };

  ipcMain.handle('tasks:load', (_e, dir: unknown): TaskBoard => {
    if (!isNonEmptyString(dir)) { rejectPayload('tasks:load', dir); return { columns: [] }; }
    startTaskWatch(dir);
    return loadTasks(dir);
  });
  ipcMain.on('tasks:save', (_e, raw: unknown) => {
    const req = parseTasksSave(raw);
    if (!req) { rejectPayload('tasks:save', raw); return; }
    const content = saveTasks(req.dir, req.board);
    lastWritten.set(req.dir, content);
    startTaskWatch(req.dir); // (re)arm now that .dmworkspace exists
  });

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  // Lets the renderer decide whether an image-paste keystroke should be
  // forwarded to the PTY (so the running program can read the image itself).
  ipcMain.handle('clipboard:has-image', () => !clipboard.readImage().isEmpty());
  // Save a clipboard image to a temp PNG so the renderer can insert its path into
  // the terminal line. This is tool-independent (any program reads a file path)
  // and works on Windows, where CLI tools can't reliably read the OS clipboard.
  ipcMain.handle('clipboard:save-image', () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) return null;
    try {
      mkdirSync(IMAGE_TMP_DIR, { recursive: true });
      const file = join(IMAGE_TMP_DIR, `paste-${Date.now()}-${randomUUID()}.png`);
      writeFileSync(file, image.toPNG(), { flag: 'wx', mode: 0o600 });
      return file;
    } catch {
      return null;
    }
  });
  ipcMain.on('clipboard:write', (_e, text: unknown) => {
    if (typeof text !== 'string') { rejectPayload('clipboard:write', text); return; }
    clipboard.writeText(text);
  });

  // Used by the markdown preview panel. The path comes from a link the user
  // clicked in terminal output, so restrict reads to text/markdown files — the
  // panel never needs anything else, and this avoids slurping arbitrary files
  // (e.g. a malicious agent printing a clickable ~/.ssh/id_rsa path).
  ipcMain.handle('file:read', (_e, path: string): string => {
    // expandTilde for consistency with every other fs-touching handler — a
    // '~/notes.md' link from terminal output must resolve to the home dir.
    return readPreviewFile(expandTilde(path));
  });

  // File browser. Unlike file:read (whose paths come from terminal output and are
  // therefore extension-restricted), these paths come from user-driven UI
  // navigation, so arbitrary paths are intentional here; size/binary guards live
  // in fs-browser.ts. readDir errors (ENOENT/EACCES) propagate to the renderer as
  // a rejected promise (shown as an inline error row). read/create surface their
  // expected FsBrowserError codes as a discriminated result so the UI can react
  // (binary/too-large => read-only; exists/invalid-name => inline message).
  ipcMain.handle('fs:readdir', (_e, path: string) => readDir(path));

  ipcMain.handle('fs:readText', (_e, path: string) => {
    try { return { ok: true as const, content: readTextFile(path) }; }
    catch (err) {
      if (err instanceof FsBrowserError && (err.code === 'binary' || err.code === 'too-large')) {
        return { ok: false as const, code: err.code };
      }
      throw err;
    }
  });

  ipcMain.handle('fs:writeText', (_e, req: { path: string; content: string }) => {
    writeTextFile(req.path, req.content);
  });

  ipcMain.handle('fs:createFile', (_e, req: { dir: string; name: string }) => {
    try { return { ok: true as const, path: createFile(req.dir, req.name) }; }
    catch (err) {
      if (err instanceof FsBrowserError && (err.code === 'exists' || err.code === 'invalid-name')) {
        return { ok: false as const, code: err.code };
      }
      throw err;
    }
  });

  // Move a file or folder (recursively) to the OS trash, so a delete is always
  // recoverable. Errors (missing path / permission) reject and surface inline.
  ipcMain.handle('fs:delete', (_e, path: string) => shell.trashItem(expandTilde(path)));

  // Open a link from the markdown preview in the system browser. http(s) only —
  // never file:/smb:/etc., which could be abused by untrusted markdown.
  ipcMain.on('shell:openExternal', (_e, url: unknown) => {
    if (typeof url !== 'string') { rejectPayload('shell:openExternal', url); return; }
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  ipcMain.handle('dialog:pickDirectory', async () => {
    // e2e-only: return a fixed path so tests can drive folder changes without
    // a native dialog (which Playwright cannot dismiss).
    if (process.env.DMWS_E2E && process.env.DMWS_E2E_PICK_DIR) return process.env.DMWS_E2E_PICK_DIR;
    const win = getWindow();
    if (!win) return null;
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
  });

  ipcMain.handle('link:resolve', (_e, req: { rel: string; cwd: string; roots: string[] }): string | null =>
    resolveLinkPath(req.rel, req.cwd, req.roots)
  );

  ipcMain.on('notify:agentDone', (_e, raw: unknown) => {
    const payload = parseAgentDone(raw);
    if (!payload) { rejectPayload('notify:agentDone', raw); return; }
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
