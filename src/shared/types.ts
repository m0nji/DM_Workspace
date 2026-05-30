import type { ShortcutAction } from './shortcuts';

export type Direction = 'h' | 'v'; // 'h' = left/right, 'v' = top/bottom

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
  showDoneBadge?: boolean;     // show the green "terminals ready" badge in the sidebar (default off)
  notificationsEnabled?: boolean; // show OS desktop notifications when a terminal is ready (default off)
  shortcutBindings?: Partial<Record<ShortcutAction, string>>; // user overrides; defaults live in shared/shortcuts.ts
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
  // terminal scrollback persistence (replayed on restart; the process itself is fresh)
  getScrollback(paneId: string): Promise<string | null>;
  saveScrollback(paneId: string, data: string): void;
  // auto-update
  checkForUpdates(): void;
  downloadUpdate(): void;
  quitAndInstall(): void;
  onUpdateEvent(cb: (e: UpdateEvent) => void): () => void;
  // clipboard (routed through the main process for reliability under contextIsolation)
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): void;
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
