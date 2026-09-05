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
  // Register-Gruppen: fehlt groupId, gehört der Workspace keiner Gruppe an.
  // Bewusst ein Seitenband statt einer Verschachtelung — `workspaces` muss eine
  // flache Liste bleiben, weil main/ipc.ts bei JEDEM state:save den Scrollback
  // gegen genau dieses Array prunt. Ein Workspace, der es auch nur
  // vorübergehend verlässt, verliert seinen Terminal-Verlauf endgültig.
  groupId?: string;
}

// Eine benannte Gruppe von Registern. Der Name darf leer sein — dann zeigt der
// Chip nur die Farbe, was der Zustand direkt nach dem Anlegen ist.
export interface WorkspaceGroup {
  id: string;
  name: string;
  color?: string;
  collapsed?: boolean; // fehlt => ausgeklappt
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

// `done` is the legacy name for an output pause, not a successful task completion.
export type PaneStatus = 'idle' | 'busy' | 'done';

// Was die Shell einer Pane gerade tut — abgeleitet aus dem privaten
// Prompt-Marker (pane-auto-title.ts), den unsere Shell-Integration bei JEDEM
// Prompt druckt. Anders als PaneStatus ist das keine Heuristik auf dem
// Ausgabestrom, sondern die Auskunft der Shell selbst: sie meldet, wann sie
// wieder am Prompt steht.
//
// 'unknown' ist der ehrliche Fall und nicht selten: Remote-Panes und Shells
// ohne unsere Integration (cmd.exe) senden nie einen Marker. Dort bleibt nur
// die Heuristik — siehe isPaneRunning in shared/pane-busy.ts.
export type PaneShellState =
  | 'unknown'   // noch kein Marker gesehen
  | 'atPrompt'  // Shell wartet auf Eingabe
  | 'running';  // Zeile abgeschickt, noch kein neuer Prompt

// Wie ein Register anzeigt, dass in ihm noch etwas arbeitet. 'off' ist der
// Default: niemand bekommt ungefragt Bewegung ins Bild.
export const BUSY_INDICATOR_KINDS = ['off', 'ring', 'pulse', 'blink', 'spin'] as const;
export type BusyIndicator = typeof BUSY_INDICATOR_KINDS[number];

// Grenzen fuer die Geschwindigkeit. Zu schnell flackert, zu langsam liest sich
// als Stillstand; ausserdem landet der Wert direkt in einer CSS-Eigenschaft und
// darf deshalb nichts Beliebiges aus der Zustandsdatei durchreichen.
export const BUSY_INDICATOR_SPEED_MIN_MS = 400;
export const BUSY_INDICATOR_SPEED_MAX_MS = 4000;
export const BUSY_INDICATOR_SPEED_DEFAULT_MS = 1200;

export const TERMINAL_FONT_SIZE_DEFAULT = 13;
export const TERMINAL_FONT_SIZE_MIN = 10;
export const TERMINAL_FONT_SIZE_MAX = 32;

export interface Settings {
  terminalFontSize?: number;   // px; absent => 13, changed live without restarting shells
  themeId: string;             // id from BUILTIN_THEMES (src/shared/themes.ts)
  terminalOpacity: number;     // 0..1 (1 = fully opaque)
  terminalBackground?: string; // optional hex override of the theme's background color
  clickMovesCursor?: boolean;  // a plain click (no modifier) moves the input cursor to the clicked cell; Option/Alt+click always does (default off)
  showDoneBadge?: boolean;     // count panes with an output pause in the sidebar (default off)
  // Anzeige laufender Sessions am Register-Punkt. Die Gegenrichtung zum
  // showDoneBadge: das zeigt, was fertig ist, dies zeigt, was noch arbeitet.
  busyIndicator?: BusyIndicator;   // fehlt => 'off'
  busyIndicatorColor?: string;     // fehlt => var(--accent)
  busyIndicatorSpeedMs?: number;   // fehlt => BUSY_INDICATOR_SPEED_DEFAULT_MS
  notificationsEnabled?: boolean; // show OS desktop notifications when terminal output pauses (default off)
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
  // Fehlt bei jedem Bestand vor den Register-Gruppen. Additiv eingeführt, ohne
  // `version` anzufassen: das Feld ist ein Gültigkeits-Gate, kein Zähler —
  // alles außer `version === 1` liefert defaultState() und damit den Verlust
  // aller Workspaces, auch bei einem Downgrade.
  workspaceGroups?: WorkspaceGroup[];
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

// Vom Server im `welcome` gemeldete Fähigkeiten (serverInfo.features, z. B.
// 'tasks' — vendor/dmw-shared/protocol.ts: ServerInfo.features). undefined
// ist NICHT dasselbe wie ein leeres Array: undefined heißt „der Server (oder
// die noch nicht abgeschlossene Verbindung) hat gar kein serverInfo
// geschickt" (Protokoll v1, zu alter Server), ein leeres Array heißt „Server
// meldet serverInfo, aber explizit keine Fähigkeiten". Nur Ersteres ist „zu
// alt" im Sinne der Tasks-Sichtbarkeitsstufen (siehe renderer/store.ts:
// tasksBlockedReason). Die Unterscheidung bleibt bis in den Store erhalten,
// auch wenn dessen heutige Logik (`!features?.includes('tasks')`) beide
// Fälle noch gleich behandelt.
export type RemoteServerFeatures = string[] | undefined;

// Antwort von remote:panes — der aktuelle Verbindungs- und Pane-Stand einer
// (Server, Scope)-Verbindung; null, wenn keine Verbindung existiert.
export interface RemoteConnectionInfo {
  status: RemoteConnectionStatus;
  clientId: string | null;
  role: RemoteRole;
  panes: RemotePaneInfo[];
  // Optional (statt required-aber-undefined), damit bestehende Testliterale
  // ohne dieses Feld gültig bleiben; der Main-Prozess liefert es immer mit.
  features?: RemoteServerFeatures;
}

// Antwort von remote:connectWorkspace — der Stand aus dem welcome.
export interface RemoteWorkspaceInfo {
  projectName: string;
  role: 'owner' | 'editor' | 'viewer';
  clientId: string;
  panes: RemotePaneInfo[];
  features?: RemoteServerFeatures;
}

// Push-Events Main -> Renderer. scopeKey identifiziert die Verbindung
// innerhalb eines Servers: die Projekt-UUID (Projekt-Scope) oder der
// reservierte Bezeichner 'user' (persönliche Runtime) — siehe
// shared/remote-pane-key.ts (USER_SCOPE_KEY).
export type RemoteStatusEvent =
  | { serverId: string; scopeKey: string; kind: 'connection'; status: RemoteConnectionStatus }
  | {
      serverId: string; scopeKey: string; kind: 'panes'; panes: RemotePaneInfo[]; clientId: string | null;
      role: RemoteRole; features?: RemoteServerFeatures;
    }
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

// ---- Geplante Agenten-Tasks (Arbeitspaket B, Aufgabe 1) --------------------
//
// Dünner REST-Client gegen die Task-API des Workspace-Servers
// (tasks/routes.ts in dm_workspace_web). Die Felder sind gegen die
// tatsächliche REST-Antwort geprüft (toTaskInfo/toRunInfo dort) und stimmen
// mit den WebSocket-Typen TaskInfo/TaskRunInfo im vendorierten
// protocol.ts überein, u. a. bei RemoteTask.projectId und
// RemoteTaskRun.startedBy — beide Felder führen REST und WS gleichermaßen.

export type RemoteTaskRunStatus =
  | 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'skipped' | 'interrupted';

export interface RemoteTaskRun {
  id: string;
  taskId: string;
  status: RemoteTaskRunStatus;
  trigger: 'schedule' | 'manual';
  startedBy: string | null; // userId, der den Lauf ausgelöst hat; null bei geplanten Läufen
  startedAt: string;        // ISO-8601
  finishedAt: string | null; // ISO-8601
  exitCode: number | null;
}

export interface RemoteTask {
  id: string;
  projectId: string;
  name: string;
  description: string;
  ownerId: string | null;
  agent: 'claude' | 'codex' | 'opencode';
  prompt: string;
  workdir: string;
  scheduleKind: 'cron' | 'interval' | 'manual';
  scheduleExpr: string;
  timezone: string;
  timeoutMs: number;
  enabled: boolean;
  nextRunAt: string | null; // ISO-8601
  lastRun: RemoteTaskRun | null;
}

// Effektive Rechte des aufrufenden Nutzers für GET .../tasks. Der Client baut
// die Regel (Rolle, task_manage_role-Einstellung, Zuweisung) NICHT nach,
// sondern übernimmt dieses vom Server schon berechnete Ergebnis 1:1 — sonst
// driften Oberfläche und Server beim nächsten Regelwechsel auseinander.
// canRun (Starten/Abbrechen) ist KEIN Alias für "Rolle ungleich viewer" —
// dieselbe Formel clientseitig nachzubauen ist genau das Muster, an dem der
// Bearbeiten-Pfad im Web-Client schon einmal zerbrochen ist (siehe
// server/src/tasks/routes.ts::taskAccess im dmw_workspace_web-Repo).
export interface RemoteTaskAccess {
  canManage: boolean;
  canRun: boolean;
  canAssign: boolean;
}

export type RemoteTaskErrorCode =
  | 'not-logged-in'  // 401 bzw. kein gespeichertes Session-Token
  | 'forbidden'       // 403 (kein Mitglied / keine Verwaltungsberechtigung)
  | 'not-found'        // 404
  | 'conflict'          // 409: läuft bereits ein Lauf im Projekt / Task hat einen laufenden Lauf
  | 'invalid'            // 400: ungültige Eingabe
  | 'network'             // Server nicht erreichbar
  | 'server';              // alles Übrige (5xx, unerwartete Antwort)

export interface RemoteTaskError {
  ok: false;
  code: RemoteTaskErrorCode;
  // Servermeldung (1:1 anzeigbar), falls vorhanden — und AUSSCHLIESSLICH die:
  // gefüllt wird das Feld nur aus dem `error`-Feld einer Serverantwort
  // (remote-tasks.ts). Der Client schreibt hier nichts Eigenes hinein, weil
  // die Oberfläche den Inhalt wörtlich anzeigt und nur bei fehlendem Feld auf
  // den übersetzten Katalogtext ausweicht. Eine fetch-Ausnahme oder ein lokal
  // formulierter Satz stünden sonst unübersetzt vor dem Nutzer.
  message?: string;
}

export type RemoteTaskListResult = { ok: true; tasks: RemoteTask[]; access: RemoteTaskAccess } | RemoteTaskError;
export type RemoteTaskResult = { ok: true; task: RemoteTask } | RemoteTaskError;
export type RemoteTaskOkResult = { ok: true } | RemoteTaskError;
export type RemoteTaskRunsResult = { ok: true; runs: RemoteTaskRun[] } | RemoteTaskError;
export type RemoteRunResult = { ok: true; run: RemoteTaskRun & { log: string } } | RemoteTaskError;

/**
 * Projektmitglied für die Auswahl „Verantwortlich" (GET /api/projects/:id/members).
 * Zuweisbar sind serverseitig nur Rollen ab 'editor' (parseTaskBody in
 * tasks/routes.ts) — 'viewer' wird trotzdem mitgeführt, weil eine bestehende
 * Zuweisung sonst unbeschriftet bliebe, wenn die Person zwischenzeitlich
 * zurückgestuft wurde.
 */
export interface RemoteProjectMember {
  userId: string;
  username: string;
  displayName: string;
  role: 'owner' | 'editor' | 'viewer';
}

export type RemoteMembersResult = { ok: true; members: RemoteProjectMember[] } | RemoteTaskError;

// Push-Events Main -> Renderer für Task-Ereignisse (Arbeitspaket B, Aufgabe 2).
// Bildet die fünf Server-Nachrichtentypen des WebSocket-Protokolls
// (vendor/dmw-shared/protocol.ts: task.changed, task.removed,
// task.run.started, task.run.log, task.run.finished) auf vier Ereignis-Arten
// ab — started/finished teilen sich 'run', der Renderer unterscheidet den
// Zustand am run.status.
// `changed` trägt bewusst KEIN lastRun: die Live-Nachricht des Servers
// (TaskInfo) führt das Feld nicht, und der Main-Prozess kennt den zuletzt
// bekannten Lauf nicht. Ein erfundenes `lastRun: null` sähe im Store aus wie
// die Aussage „dieser Task hat noch nie gelaufen" und würde den laufenden Lauf
// löschen. Zusammenführen kann das nur der Store, der die Liste hält.
export type RemoteTaskEvent =
  | { serverId: string; scopeKey: string; kind: 'changed'; task: Omit<RemoteTask, 'lastRun'> }
  | { serverId: string; scopeKey: string; kind: 'removed'; taskId: string }
  | { serverId: string; scopeKey: string; kind: 'run'; run: RemoteTaskRun }
  | { serverId: string; scopeKey: string; kind: 'log'; runId: string; chunk: string };

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
  // Geplante Agenten-Tasks (Arbeitspaket B, Aufgabe 2): dünne REST-Aufrufe wie
  // remoteFs* oben, Push-Ereignisse über onRemoteTask. body bleibt bewusst
  // ungeprüft durchgereicht — die serverseitige Validierung (parseTaskBody in
  // tasks/routes.ts) ist die Quelle der Wahrheit, das IPC nur ein Transport.
  remoteTasksList(serverId: string, projectId: string): Promise<RemoteTaskListResult>;
  remoteTasksCreate(serverId: string, projectId: string, body: Record<string, unknown>): Promise<RemoteTaskResult>;
  remoteTasksUpdate(serverId: string, projectId: string, taskId: string, body: Record<string, unknown>): Promise<RemoteTaskResult>;
  remoteTasksRemove(serverId: string, projectId: string, taskId: string): Promise<RemoteTaskOkResult>;
  remoteTasksRun(serverId: string, projectId: string, taskId: string): Promise<RemoteTaskOkResult>;
  remoteTasksCancel(serverId: string, projectId: string, runId: string): Promise<RemoteTaskOkResult>;
  remoteTasksListRuns(serverId: string, projectId: string, taskId: string): Promise<RemoteTaskRunsResult>;
  remoteTasksGetRun(serverId: string, projectId: string, runId: string): Promise<RemoteRunResult>;
  /** Projektmitglieder für die Zuweisung eines Tasks (Auswahl statt roher Nutzer-ID). */
  remoteMembersList(serverId: string, projectId: string): Promise<RemoteMembersResult>;
  // Live-Protokoll eines laufenden Runs; scopeKey wie bei remoteConnectWorkspace
  // (Projekt-UUID oder 'user').
  remoteTaskLogSubscribe(serverId: string, scopeKey: string, runId: string): void;
  remoteTaskLogUnsubscribe(serverId: string, scopeKey: string, runId: string): void;
  onRemoteTask(cb: (e: RemoteTaskEvent) => void): () => void;
}

declare global {
  interface Window {
    api: RendererApi;
  }
  // Injected at build time by electron-vite (see electron.vite.config.ts).
  const __APP_VERSION__: string;
}
