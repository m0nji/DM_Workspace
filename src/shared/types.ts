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
}

export interface Settings {
  terminalBackground: string; // hex color, e.g. '#0d0d0d'
  terminalOpacity: number;    // 0..1 (1 = fully opaque)
}

export interface AppState {
  version: 1;
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  settings: Settings;
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
  // auto-update
  checkForUpdates(): void;
  downloadUpdate(): void;
  quitAndInstall(): void;
  onUpdateEvent(cb: (e: UpdateEvent) => void): () => void;
}

declare global {
  interface Window {
    api: RendererApi;
  }
  // Injected at build time by electron-vite (see electron.vite.config.ts).
  const __APP_VERSION__: string;
}
