import type { ShortcutAction } from './shortcuts';
export type { Task, TaskColumn, TaskBoard } from './tasks-markdown';

export type Direction = 'h' | 'v'; // 'h' = left/right, 'v' = top/bottom

export type SettingsSection = 'appearance' | 'shortcuts' | 'templates' | 'session' | 'notifications' | 'updates';

export type WorkspaceNavigationPlacement = 'left' | 'top';

export interface PaneNode {
  type: 'pane';
  id: string; // unique id; also used as the PTY pane identifier
}

export interface SplitNode {
  type: 'split';
  id: string;
  direction: Direction;
  ratio: number; // 0..1 size of first child
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = PaneNode | SplitNode;

export type PresetKind = '1' | '2h' | '2v' | '4' | '8';

export interface Workspace {
  id: string;
  name: string;
  cwd: string;          // default working directory for new panes
  layout: LayoutNode | null; // null => welcome screen
  color?: string;       // optional hex accent shown in the sidebar
  paneTitles?: Record<string, string>;            // custom pane label keyed by pane id (overrides live cwd when set)
  pendingStartupCommands?: Record<string, string>; // one-shot commands to send after a pane spawns (created-from-template)
  tasksEnabled?: boolean; // opt-in: show the task board for this workspace (default off)
}

// A reusable workspace blueprint: layout + folder + optional pane titles and
// startup commands. Templates are managed in Settings and instantiated from the
// Command Palette / Settings; instantiating clones the layout with fresh ids.
export interface WorkspaceTemplate {
  id: string;
  name: string;
  cwd: string;
  layout: LayoutNode;
  color?: string;
  paneTitles?: Record<string, string>;
  startupCommands?: Record<string, string>;
  confirmStartupCommands: boolean; // ask before running startup commands when creating from this template
}

export type PaneStatus = 'idle' | 'busy' | 'done';

export interface Settings {
  themeId: string;             // id from BUILTIN_THEMES (src/shared/themes.ts)
  terminalOpacity: number;     // 0..1 (1 = fully opaque)
  terminalBackground?: string; // optional hex override of the theme's background color
  clickMovesCursor?: boolean;  // a plain click (no modifier) moves the input cursor to the clicked cell; Option/Alt+click always does (default off)
  showDoneBadge?: boolean;     // show the green "terminals ready" badge in the sidebar (default off)
  notificationsEnabled?: boolean; // show OS desktop notifications when a terminal is ready (default off)
  restoreTerminalHistory?: boolean; // Terminal-Verlauf nach einem Neustart wiederherstellen (default an); aus => es wird gar kein Verlauf gespeichert
  workspaceNavigationPlacement?: WorkspaceNavigationPlacement; // workspace navigation placement (default left)
  shortcutBindings?: Partial<Record<ShortcutAction, string>>; // user overrides; defaults live in shared/shortcuts.ts
  locale?: 'en' | 'de';        // UI language; unset => detect from OS, fallback 'en'
  brandDesign?: 'graphite' | 'standard' | 'black'; // DM BrandDesign family for the app chrome (default graphite = corporate Graphite Sand); terminal themes stay independent
}

export interface WindowBounds {
  x?: number;          // fehlt => beim Start zentrieren
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
}

export interface AppState {
  version: 1;
  workspaces: Workspace[];
  workspaceTemplates?: WorkspaceTemplate[];
  activeWorkspaceId: string | null;
  settings: Settings;
  windowBounds?: WindowBounds; // vom Main-Prozess verwaltet; fehlt beim Erststart
}

// ---- File browser ----
export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}
export type ReadTextResult = { ok: true; content: string } | { ok: false; code: 'binary' | 'too-large' };
export type CreateFileResult = { ok: true; path: string } | { ok: false; code: 'exists' | 'invalid-name' };

export interface AgentDonePayload {
  workspaceId: string;
  workspaceName: string;
  paneTitle: string;
}

// ---- IPC payloads ----
export interface PtySpawnRequest {
  paneId: string;
  cwd: string;
  cols: number;
  rows: number;
}
export interface PtyDataEvent {
  paneId: string;
  data: string;
}
export interface PtyInputRequest {
  paneId: string;
  data: string;
}
export interface PtyResizeRequest {
  paneId: string;
  cols: number;
  rows: number;
}
export interface PtyExitEvent {
  paneId: string;
  exitCode: number;
}

// Auto-update lifecycle events sent from main to the renderer.
export type UpdateEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }
  | { type: 'disabled' }; // updates only work in the packaged app

// Shape exposed on window.api by the preload script
export interface RendererApi {
  spawn(req: PtySpawnRequest): Promise<void>;
  input(req: PtyInputRequest): void;
  resize(req: PtyResizeRequest): void;
  kill(paneId: string): void;
  onData(paneId: string, cb: (data: string) => void): () => void;
  onExit(paneId: string, cb: (exitCode: number) => void): () => void;
  loadState(): Promise<AppState>;
  saveState(state: AppState): Promise<void>;
  pickDirectory(): Promise<string | null>;
  // resolve a relative link target against cwd / its subdirs / workspace roots; null if not found
  resolveLink(rel: string, cwd: string, roots: string[]): Promise<string | null>;
  // read a UTF-8 text file (used by the markdown preview)
  readFile(path: string): Promise<string>;
  // file browser: list a directory, read/write text, create a new empty file,
  // delete a file/folder (to the OS trash)
  readDir(path: string): Promise<DirEntry[]>;
  readTextFile(path: string): Promise<ReadTextResult>;
  writeTextFile(path: string, content: string): Promise<void>;
  createFile(dir: string, name: string): Promise<CreateFileResult>;
  deletePath(path: string): Promise<void>;
  // task board (TASKS.md per working dir)
  loadTasks(dir: string): Promise<import('./tasks-markdown').TaskBoard>;
  saveTasks(dir: string, board: import('./tasks-markdown').TaskBoard): void;
  onTasksChanged(cb: (dir: string, board: import('./tasks-markdown').TaskBoard) => void): () => void;
  // terminal scrollback persistence (replayed on restart; the process itself is fresh)
  getScrollback(paneId: string): Promise<string | null>;
  saveScrollback(paneId: string, data: string): void;
  // auto-update
  checkForUpdates(): void;
  downloadUpdate(): void;
  quitAndInstall(): void;
  // fetch the offered version's release notes (GitHub release body) for the update dialog
  fetchUpdateNotes(version: string): Promise<string | null>;
  onUpdateEvent(cb: (e: UpdateEvent) => void): () => void;
  // clipboard (routed through the main process for reliability under contextIsolation)
  clipboardRead(): Promise<string>;
  clipboardHasImage(): Promise<boolean>;
  // save a clipboard image to a temp file; returns its path, or null if none/failed
  clipboardSaveImage(): Promise<string | null>;
  clipboardWrite(text: string): void;
  // resolve the real filesystem path of a dropped File
  getPathForFile(file: File): string;
  // open an http(s) link in the system browser (markdown preview links)
  openExternal(url: string): void;
  // the host platform (for path-escaping decisions in the renderer)
  platform: NodeJS.Platform;
  // e2e-only: keep xterm on the DOM renderer for tests that assert terminal text
  disableWebgl: boolean;
  // e2e-only: true when launched with DMWS_E2E=1, gates the window.__store hook
  isE2E: boolean;
  // agent-activity notifications
  notifyAgentDone(payload: AgentDonePayload): void;
  onWindowFocus(cb: (focused: boolean) => void): () => void;
  onActivateWorkspace(cb: (workspaceId: string) => void): () => void;
}

declare global {
  interface Window {
    api: RendererApi;
  }
  // Injected at build time by electron-vite (see electron.vite.config.ts).
  const __APP_VERSION__: string;
}
