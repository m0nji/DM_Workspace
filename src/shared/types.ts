import type { ShortcutAction } from './shortcuts';
export type { Task, TaskColumn, TaskBoard } from './tasks-markdown';

export type Direction = 'h' | 'v'; // 'h' = left/right, 'v' = top/bottom

export type SettingsSection = 'appearance' | 'shortcuts' | 'templates' | 'session' | 'notifications' | 'account' | 'updates';

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
  // Remote-Workspaces (Plan 4.4): fehlt kind, ist der Workspace lokal (heutiger
  // Zustand). Ein Remote-Workspace spiegelt die Panes eines Server-Projekts
  // oder der persönlichen User-Runtime (Phase D); seine Pane-Schlüssel sind
  // namespaced (shared/remote-pane-key.ts), die Layout-Anordnung bleibt lokal
  // frei (Entscheidung E8).
  kind?: 'local' | 'remote';
  remote?: RemoteWorkspaceRef;
}

// Verweis eines Remote-Workspace auf seine Server-Verbindung. Bestände aus
// B2/B3 haben kein scope-Feld — migrateWorkspace ergänzt dann 'project'
// (User-Workspaces gibt es erst seit diesem Feld).
export type RemoteWorkspaceRef =
  | { serverId: string; scope: 'project'; projectId: string }
  | { serverId: string; scope: 'user' };

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
  // Konfigurierte Workspace-Server (Remote-Workspaces). Bewusst OHNE Secrets:
  // Session-Tokens liegen ausschließlich im Main-Prozess (safeStorage).
  servers?: ServerConfig[];
}

// Ein konfigurierter dm_workspace_web-Server. baseUrl ohne Pfad/Trailing-Slash,
// z. B. "https://dmw.example".
export interface ServerConfig {
  id: string;
  name: string;
  baseUrl: string;
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

// ---- Remote-Workspaces (Renderer-sichtbare DTOs, IMMER ohne Tokens) --------

// Angemeldeter Nutzer eines Workspace-Servers (Projektion von /api/me).
export interface RemoteUser {
  username: string;
  displayName: string;
}

export type RemoteAuthStatus =
  | { loggedIn: false }
  | { loggedIn: true; user: RemoteUser };

// Ergebnis eines direkten Logins bzw. einer Gerätekopplung. Fehler kommen als
// ok:false zurück (kein Throw über die IPC-Grenze — die Meldung soll 1:1 in
// der UI erscheinen, ohne "Error invoking remote method"-Präfix).
export type RemoteLoginResult =
  | { ok: true; user?: RemoteUser }
  | { ok: false; error: string };

export type DevicePairingResult =
  | { status: 'ok'; user?: RemoteUser }
  | { status: 'expired' | 'consumed' | 'error'; message?: string };

export interface RemoteProject {
  id: string;
  slug: string;
  name: string;
  role: 'owner' | 'editor' | 'viewer';
}

// Spiegel von PaneInfo aus dem WS-Protokoll v2 (@dmw/shared) — hier dupliziert,
// damit Renderer-Code nicht in den Main-Vendor-Ordner importiert.
export interface RemotePaneInfo {
  paneId: string;
  title: string;
  cols: number;
  rows: number;
  driver: string | null;      // clientId des aktuellen Drivers
  driverQueue: string[];
  queueDeadline: number | null;
  running: boolean;
}

export interface RemotePresenceUser {
  clientId: string;
  name: string;
  color: string;
  activePane: string | null;
}

// Verbindungsstatus einer (Server, Scope)-Verbindung. Deckungsgleich mit dem
// ConnectionStatus des @dmw/client: kicked = Close-Code 4403 (kein Reconnect),
// runtime-stopped = 4205 (Runtime schläft, Aufwecken nötig).
export type RemoteConnectionStatus =
  | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'kicked' | 'runtime-stopped';

// Zustand der persönlichen User-Runtime (REST GET /api/runtimes/user):
// running = Container läuft, sleeping = Container existiert, ist aber gestoppt,
// none = noch nie provisioniert. Fehler kommen wie bei den Auth-Kanälen als
// ok:false-Ergebnis zurück (Servermeldung 1:1 anzeigbar).
export type RemoteUserRuntimeState = 'running' | 'sleeping' | 'none';

export type RemoteUserRuntimeResult =
  | { ok: true; status: RemoteUserRuntimeState; paneCount: number; limits?: { memory: string; cpus: string } }
  | { ok: false; error: string };

// Ergebnis von POST /api/runtimes/user/stop. Die laufende WS-Verbindung
// schließt der Server danach selbst mit 4205 (-> Status runtime-stopped).
export type RemoteUserRuntimeStopResult = { ok: true } | { ok: false; error: string };

// Projektrolle des angemeldeten Nutzers (Server-Vokabular).
export type RemoteRole = 'owner' | 'editor' | 'viewer';

// Antwort von remote:panes — der aktuelle Verbindungs- und Pane-Stand einer
// (Server, Scope)-Verbindung; null, wenn keine Verbindung existiert.
export interface RemoteConnectionInfo {
  status: RemoteConnectionStatus;
  clientId: string | null;
  role: RemoteRole;
  panes: RemotePaneInfo[];
}

// Antwort von remote:connectWorkspace — der Stand aus dem welcome.
export interface RemoteWorkspaceInfo {
  projectName: string;
  role: 'owner' | 'editor' | 'viewer';
  clientId: string;
  panes: RemotePaneInfo[];
}

// Push-Events Main -> Renderer. scopeKey identifiziert die Verbindung
// innerhalb eines Servers: die Projekt-UUID (Projekt-Scope) oder der
// reservierte Bezeichner 'user' (persönliche Runtime) — siehe
// shared/remote-pane-key.ts (USER_SCOPE_KEY).
export type RemoteStatusEvent =
  | { serverId: string; scopeKey: string; kind: 'connection'; status: RemoteConnectionStatus }
  | { serverId: string; scopeKey: string; kind: 'panes'; panes: RemotePaneInfo[]; clientId: string | null; role: RemoteRole }
  // Der Server hat eine Aktion abgelehnt (z. B. forbidden bei Rolle 'viewer').
  // Kein Verbindungsabbruch — nur eine Rückmeldung an die auslösende Stelle.
  | { serverId: string; scopeKey: string; kind: 'error'; code: string; paneId: string | null };

export interface RemoteDriverEvent {
  serverId: string;
  scopeKey: string;
  paneId: string;             // Remote-Pane-Id (unnamespaced)
  driver: string | null;
  driverQueue: string[];
  queueDeadline: number | null;
  clientId: string | null;    // eigene clientId zum Selbst-Vergleich
  denied?: boolean;           // true: die eigene Anfrage wurde abgelehnt
}

export interface RemotePresenceEvent {
  serverId: string;
  scopeKey: string;
  users: RemotePresenceUser[];
}

// ---- Remote-Dateizugriff (Arbeitspaket B3) ---------------------------------
//
// Dünner REST-Client gegen die Datei-API des Workspace-Servers (files/routes.ts
// in dm_workspace_web). Pfade sind relative Projektpfade ohne führenden Slash
// ('' = Projektroot); der Server erzwingt die Projektgrenze zusätzlich selbst.
// Fehler kommen als ok:false-Ergebnis zurück (kein Throw über die IPC-Grenze),
// damit die UI gezielt reagieren kann — insbesondere auf den 409-Konflikt.

export type RemoteFsErrorCode =
  | 'not-logged-in'   // 401 bzw. kein gespeichertes Session-Token
  | 'forbidden'       // 403 (kein Mitglied / Viewer bei Schreiboperation)
  | 'not-found'       // 404
  | 'conflict'        // 409: Datei wurde serverseitig zwischenzeitlich geändert
  | 'too-large'       // 413: Server-Limit (1 MB) überschritten
  | 'binary'          // 415: keine UTF-8-Textdatei
  | 'invalid-path'    // 400 bzw. lokal abgelehnter Pfad
  | 'network'         // Server nicht erreichbar
  | 'server';         // alles Übrige (5xx, unerwartete Antwort)

export interface RemoteFsError {
  ok: false;
  code: RemoteFsErrorCode;
  message?: string;      // Servermeldung (1:1 anzeigbar), falls vorhanden
  serverMtime?: number;  // bei 'conflict': aktuelle Server-mtime (Sekunden), best effort
}

export interface RemoteFsEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export type RemoteFsListResult = { ok: true; entries: RemoteFsEntry[] } | RemoteFsError;
// mtime: serverseitige mtime in Sekunden — opakes Token für das optimistic
// Locking (beim Speichern als baseMtime zurückgeben).
export type RemoteFsReadResult = { ok: true; content: string; mtime: number; size: number } | RemoteFsError;
export type RemoteFsWriteResult = { ok: true; mtime: number } | RemoteFsError;
export type RemoteFsOkResult = { ok: true } | RemoteFsError;

// ---- IPC payloads ----

// Ziel eines Spawns (Remote-Workspaces-Plan, Abschnitt 4.4). Fehlt das Feld,
// ist der Spawn lokal — der heutige (und in B1 einzige) Pfad. `remote` wird
// erst mit dem RemotePtyBackend in B2 bedienbar; bis dahin lehnt der
// BackendRouter solche Spawns ab.
export type SpawnTargetScope =
  | { kind: 'project'; projectId: string } // geteilte Projekt-Runtime
  | { kind: 'user' };                      // persönliche User-Runtime

export type SpawnTarget =
  | { kind: 'local' }
  | { kind: 'remote'; serverId: string; scope: SpawnTargetScope; remotePaneId: string };

export interface PtySpawnRequest {
  paneId: string;
  cwd: string;
  cols: number;
  rows: number;
  target?: SpawnTarget;
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
  // Authenticates the local shell prompt marker — only a marker carrying this
  // value arms the auto-title tracker. '' means "trust none" (see
  // shared/prompt-nonce.ts and main/prompt-nonce.ts).
  promptNonce: string;
  // agent-activity notifications
  notifyAgentDone(payload: AgentDonePayload): void;
  onWindowFocus(cb: (focused: boolean) => void): () => void;
  onActivateWorkspace(cb: (workspaceId: string) => void): () => void;
  // ---- Remote-Workspaces (alle Token bleiben im Main-Prozess) ----
  authLoginLocal(serverId: string, username: string, password: string): Promise<RemoteLoginResult>;
  // startet die Gerätekopplung, öffnet den Browser und pollt bis ok/expired
  authStartDevicePairing(serverId: string): Promise<DevicePairingResult>;
  authLogout(serverId: string): Promise<void>;
  authStatus(serverId: string): Promise<RemoteAuthStatus>;
  serverAdd(server: ServerConfig): Promise<void>;
  serverRemove(serverId: string): Promise<void>;
  remoteProjects(serverId: string): Promise<RemoteProject[]>;
  // Persönliche User-Runtime des angemeldeten Nutzers (Phase D): Status fürs
  // Anlegen des User-Workspace, Stop als Gegenstück zum 4205-„Wecken".
  remoteUserRuntime(serverId: string): Promise<RemoteUserRuntimeResult>;
  remoteUserRuntimeStop(serverId: string): Promise<RemoteUserRuntimeStopResult>;
  // scopeKey: Projekt-UUID oder 'user' (shared/remote-pane-key.ts).
  remoteConnectWorkspace(serverId: string, scopeKey: string): Promise<RemoteWorkspaceInfo>;
  remotePanes(serverId: string, scopeKey: string): Promise<RemoteConnectionInfo | null>;
  remoteDisconnect(serverId: string, scopeKey: string): void;
  remoteDriverRequest(serverId: string, scopeKey: string, paneId: string): void;
  remoteDriverRelease(serverId: string, scopeKey: string, paneId: string): void;
  remoteDriverApprove(serverId: string, scopeKey: string, paneId: string, clientId: string): void;
  remoteDriverDeny(serverId: string, scopeKey: string, paneId: string, clientId: string): void;
  // Panes des Projekts: wirken für alle Verbundenen (Rolle 'viewer' wird
  // serverseitig mit forbidden abgelehnt).
  remotePaneCreate(serverId: string, scopeKey: string): void;
  remotePaneClose(serverId: string, scopeKey: string, paneId: string): void;
  onRemoteStatus(cb: (e: RemoteStatusEvent) => void): () => void;
  onRemoteDriver(cb: (e: RemoteDriverEvent) => void): () => void;
  onRemotePresence(cb: (e: RemotePresenceEvent) => void): () => void;
  // Remote-Dateizugriff (B3): Pfade sind relative Projektpfade ('' = Root).
  remoteFsList(serverId: string, projectId: string, path: string): Promise<RemoteFsListResult>;
  remoteFsRead(serverId: string, projectId: string, path: string): Promise<RemoteFsReadResult>;
  remoteFsWrite(serverId: string, projectId: string, path: string, content: string, baseMtime?: number): Promise<RemoteFsWriteResult>;
  remoteFsMkdir(serverId: string, projectId: string, path: string): Promise<RemoteFsOkResult>;
  remoteFsDelete(serverId: string, projectId: string, path: string): Promise<RemoteFsOkResult>;
  remoteFsRename(serverId: string, projectId: string, from: string, to: string): Promise<RemoteFsOkResult>;
}

declare global {
  interface Window {
    api: RendererApi;
  }
  // Injected at build time by electron-vite (see electron.vite.config.ts).
  const __APP_VERSION__: string;
}
