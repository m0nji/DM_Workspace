import { create } from 'zustand';
import type {
  AppState, PresetKind, Direction, Workspace, WorkspaceTemplate, Settings, UpdateEvent, PaneStatus, SettingsSection,
  LayoutNode, RemoteConnectionStatus, RemoteDriverEvent, RemotePaneInfo, RemotePresenceEvent,
  RemotePresenceUser, RemoteRole, RemoteStatusEvent, RemoteWorkspaceRef, ServerConfig, SpawnTargetScope,
  RemoteTask, RemoteTaskAccess, RemoteTaskError, RemoteTaskEvent, RemoteProjectMember
} from '../shared/types';
import type { RemoteFilesContext } from './files-api';
import {
  makePreset, splitPane, closePane, setRatio, collectPaneIds, collectSplitIds
} from '../shared/layout-tree';
import { cloneTemplateLayout, remapStringMap } from '../shared/template-layout';
import { createIdGenerator } from '../shared/ids';
import { DEFAULT_THEME_ID } from '../shared/themes';
import { USER_SCOPE_KEY, isRemotePaneKey, parseRemotePaneKey, remotePaneKey, remoteScopeKey } from '../shared/remote-pane-key';
import type { ShortcutAction } from '../shared/shortcuts';
import type { PreviewSource } from '../shared/link-detect';
// Der Store hält fast nur Codes und lässt die Oberfläche übersetzen (siehe
// pane.remoteBlocked.<reason>). Eine Ausnahme braucht die i18n-Instanz direkt:
// der Kürzungsvermerk wandert in den gespeicherten Protokolltext hinein und
// muss deshalb schon beim Kürzen übersetzt vorliegen.
import i18n from './i18n';
import { focusTerminal, refreshTerminalLayoutAfterCommit, trackTerminalInput } from './terminal-registry';

const DEFAULT_SETTINGS: Settings = {
  themeId: DEFAULT_THEME_ID,
  // 0.95: a hint of window vibrancy while keeping the reserved scrollbar gutter
  // from reading as a band (the WebGL canvas composites translucency a few levels
  // lighter than the CSS-painted gutter; the gap scales with 1-opacity, so a near-
  // opaque terminal makes it imperceptible).
  terminalOpacity: 0.95,
  clickMovesCursor: false,
  showDoneBadge: false,
  notificationsEnabled: false,
  restoreTerminalHistory: true,
  workspaceNavigationPlacement: 'left',
  brandDesign: 'graphite'
};

export type UpdateStatus =
  | 'idle' | 'checking' | 'available' | 'downloading'
  | 'downloaded' | 'not-available' | 'error' | 'disabled';

export interface UpdateState {
  status: UpdateStatus;
  version?: string;
  percent?: number;
  error?: string;
}

const nextPaneId = createIdGenerator('p');
const nextSplitId = createIdGenerator('s');
const nextWsId = createIdGenerator('w');
const nextTemplateId = createIdGenerator('tpl');
const nextServerId = createIdGenerator('srv');

// ---- Remote-Workspaces ------------------------------------------------------

// Verbindungszustand einer (Server, Scope)-Verbindung, gespeist aus den
// remote:*-Pushes des Main-Prozesses. Schlüssel: remoteConnKey(); scopeKey ist
// die Projekt-UUID oder 'user' (shared/remote-pane-key.ts).
export interface RemoteConnectionState {
  status: RemoteConnectionStatus;
  clientId: string | null;             // eigene Presence-Identität
  role: RemoteRole | null;             // eigene Projektrolle (null = noch unbekannt)
  panes: RemotePaneInfo[];             // Server-Panes inkl. Driver/Queue
  presence: RemotePresenceUser[];
  deniedPaneId: string | null;         // Remote-Pane, deren eigene Driver-Anfrage abgelehnt wurde
  // Zuletzt abgelehnte Aktion — vom Server (code aus dem Protokoll) oder schon
  // hier blockiert (code aus RemoteBlockReason). `at` ist der Zeitpunkt: die
  // Meldung verschwindet nach REMOTE_ERROR_TTL_MS wieder von selbst, sonst
  // bliebe eine einzelne Ablehnung dauerhaft rot stehen (siehe RemotePaneBar).
  lastError: { code: string; paneId: string | null; at: number } | null;
  // Wohin die nächste neue Pane dieser Verbindung soll. Das Layout entsteht erst
  // beim panes-Push (der Server kennt keine Anordnung), der Wunsch „rechts von
  // dieser Pane" aber schon beim Klick — hier wird er zwischengeparkt und beim
  // nächsten pane.added eingelöst. `at` begrenzt die Gültigkeit: legt jemand
  // anderes vorher eine Pane an, soll sie nicht an unserem Anker landen.
  pendingPlacement?: { anchorPaneId: string; direction: Direction; at: number } | null;
  // Vom Server im `welcome` gemeldete Fähigkeiten (serverInfo.features, z. B.
  // 'tasks') — bestimmt die dritte Sichtbarkeitsstufe des Tasks-Bereichs
  // (siehe tasksBlockedReason). undefined heißt „noch kein welcome ODER
  // Server zu alt für serverInfo"; ein leeres Array hieße „Server meldet
  // serverInfo, aber keine Fähigkeiten" — tasksBlockedReason behandelt beide
  // heute gleich (`server-too-old`), die Unterscheidung bleibt aber bis
  // hierher erhalten (siehe RemoteServerFeatures in shared/types.ts).
  serverFeatures?: string[];
}

// Wie lange eine abgelehnte Aktion angezeigt wird. Lang genug zum Lesen, kurz
// genug, dass sie nicht als Dauerzustand missverstanden wird.
export const REMOTE_ERROR_TTL_MS = 8000;

// Wie lange ein Platzierungswunsch auf seine Pane wartet. Eine Server-Runde
// dauert Millisekunden; verstreicht mehr, war es nicht mehr unser pane.added.
export const REMOTE_PLACEMENT_TTL_MS = 10000;

// Spiegelt MAX_PANES aus dem Server-Repo (DM_Workspace_Web,
// server/src/session/hub.ts). Der Server antwortet inzwischen mit `pane_limit`,
// wenn man es trotzdem versucht — das Duplikat bleibt trotzdem, weil es einen
// anderen Zweck erfüllt: Der Desktop deaktiviert den Knopf VORHER und nennt den
// Grund, statt den Nutzer klicken zu lassen und ihm danach eine Fehlermeldung
// zu zeigen. Bei einer Änderung im Server muss dieser Wert mitgezogen werden;
// die Grenze gehört perspektivisch nach @dmw/shared, dann kommt sie über
// `npm run sync:dmw-client` mit statt von Hand.
export const REMOTE_MAX_PANES = 6;

export const remoteConnKey = (serverId: string, scopeKey: string): string => `${serverId}:${scopeKey}`;

// Nur die Verbindung prüfen (Status 'connected'), unabhängig von der Rolle —
// getrennt von der Rollenprüfung, weil „nicht verbunden" und „nur Lesezugriff"
// in der Oberfläche verschiedene Gründe sind (siehe RemoteBlockReason).
function isRemoteConnected(
  remote: Record<string, RemoteConnectionState>,
  paneId: string
): boolean {
  const ref = parseRemotePaneKey(paneId);
  if (!ref) return false;
  return remote[remoteConnKey(ref.serverId, ref.scopeKey)]?.status === 'connected';
}

// Anlegen und Schließen von Projekt-Panes verlangt serverseitig Schreibrolle
// (canWrite = role !== 'viewer') und eine stehende Verbindung. Wir prüfen beides
// vorab, damit die Knöpfe deaktiviert statt wirkungslos sind.
function canActOnRemotePanes(
  remote: Record<string, RemoteConnectionState>,
  paneId: string
): boolean {
  if (!isRemoteConnected(remote, paneId)) return false;
  const ref = parseRemotePaneKey(paneId)!;
  const conn = remote[remoteConnKey(ref.serverId, ref.scopeKey)]!;
  return conn.role !== null && conn.role !== 'viewer';
}

// Warum eine Remote-Pane-Aktion gerade nicht geht. Die Namen sind zugleich der
// i18n-Teilschlüssel (`pane.remoteBlocked.<reason>`) und der Fehlercode im
// lastError-Slot — ein Grund, eine Zeichenkette, keine Übersetzungstabelle.
export type RemoteBlockReason = 'offline' | 'viewer' | 'paneLimit' | 'lastPane';

function remoteConnOf(
  remote: Record<string, RemoteConnectionState>,
  paneId: string
): RemoteConnectionState | undefined {
  const ref = parseRemotePaneKey(paneId);
  return ref ? remote[remoteConnKey(ref.serverId, ref.scopeKey)] : undefined;
}

// Anlegen: verlangt Verbindung, Schreibrolle und Platz im Projekt. Die
// Kapazitätsgrenze prüfen wir selbst, weil der Server sie zwar durchsetzt, das
// Ergebnis von createPane aber verwirft — ein `+` am Limit bliebe sonst wirkungslos.
export function remotePaneCreateBlock(
  remote: Record<string, RemoteConnectionState>,
  paneId: string
): RemoteBlockReason | null {
  if (!isRemoteConnected(remote, paneId)) return 'offline';
  if (!canActOnRemotePanes(remote, paneId)) return 'viewer';
  const conn = remoteConnOf(remote, paneId);
  if (conn && conn.panes.length >= REMOTE_MAX_PANES) return 'paneLimit';
  return null;
}

// Schließen: dieselben Voraussetzungen, dazu die Server-Regel „das letzte Pane
// bleibt" (hub.closePane gibt dort false zurück, ebenfalls ohne Meldung). Ohne
// diese Prüfung fragt der Dialog „für alle schließen?", und danach passiert nichts.
export function remotePaneCloseBlock(
  remote: Record<string, RemoteConnectionState>,
  paneId: string
): RemoteBlockReason | null {
  if (!isRemoteConnected(remote, paneId)) return 'offline';
  if (!canActOnRemotePanes(remote, paneId)) return 'viewer';
  const conn = remoteConnOf(remote, paneId);
  if (conn && conn.panes.length <= 1) return 'lastPane';
  return null;
}

// Eine hier blockierte Aktion landet im selben lastError-Slot wie eine
// Server-Ablehnung — RemotePaneBar zeigt beides an derselben Stelle. Der Grund
// wird auf die auslösende Pane eingegrenzt, damit er nicht in fremden Panes
// derselben Verbindung aufpoppt.
function withRemoteError(
  remote: Record<string, RemoteConnectionState>,
  paneId: string,
  code: string
): Record<string, RemoteConnectionState> {
  const ref = parseRemotePaneKey(paneId);
  const conn = ref ? remote[remoteConnKey(ref.serverId, ref.scopeKey)] : undefined;
  if (!ref || !conn) return remote;
  const key = remoteConnKey(ref.serverId, ref.scopeKey);
  return { ...remote, [key]: { ...conn, lastError: { code, paneId: ref.remotePaneId, at: Date.now() } } };
}

// Gegenstück: eine gelungene Aktion räumt die vorige Meldung ab, damit nicht
// die Ablehnung von eben neben dem gerade erfolgreichen Klick stehen bleibt.
function withoutRemoteError(
  remote: Record<string, RemoteConnectionState>,
  paneId: string
): Record<string, RemoteConnectionState> {
  const ref = parseRemotePaneKey(paneId);
  const conn = ref ? remote[remoteConnKey(ref.serverId, ref.scopeKey)] : undefined;
  if (!ref || !conn?.lastError) return remote;
  return { ...remote, [remoteConnKey(ref.serverId, ref.scopeKey)]: { ...conn, lastError: null } };
}

// scopeKey des persistierten Remote-Verweises eines Workspace.
export function workspaceScopeKey(ref: RemoteWorkspaceRef): string {
  return ref.scope === 'user' ? USER_SCOPE_KEY : ref.projectId;
}

/**
 * Gibt es den Tasks-Bereich überhaupt? Vier Stufen, und die erste ist die
 * wichtigste: sehr viele Nutzer betreiben DM Workspace rein lokal. Für sie
 * darf die Funktion NIRGENDS auftauchen – kein Schalter, kein Palettenbefehl,
 * kein Tastenkürzel. Eine Funktion, die man nicht nutzen kann, ist kein
 * Hinweis auf Möglichkeiten, sondern Ballast.
 *
 * Die Regel steht bewusst an EINER Stelle: Panel, Titelleiste und Palette
 * fragen dieselbe Funktion. Sonst entstehen genau die Zustände, in denen der
 * Palettenbefehl noch existiert, während der Knopf längst weg ist.
 */
export function tasksBlockedReason(
  s: Pick<StoreState, 'settings' | 'workspaces' | 'activeWorkspaceId' | 'remote'>
): 'no-server' | 'local-workspace' | 'user-runtime' | 'server-too-old' | null {
  if (!s.settings.servers?.length) return 'no-server';
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (!ws || ws.kind !== 'remote' || !ws.remote) return 'local-workspace';
  // Geplante Tasks hängen serverseitig ausschließlich am Projekt: die gesamte
  // Task-API liegt unter /api/projects/:projectId/... (tasks/routes.ts). Ein
  // Remote-Workspace kann aber auch die persönliche User-Runtime sein; dort
  // liefert workspaceScopeKey() den reservierten Bezeichner 'user', den der
  // REST-Client als Projekt-Id in die URL setzen würde — der Server sucht
  // dann eine Projekt-UUID namens 'user' und antwortet mit einem Fehler.
  // Die dritte Stufe unten fängt das nicht ab: der Server meldet
  // features: ['tasks'] verbindungsweit, unabhängig vom Scope. Dieselbe
  // Unterscheidung zieht PreviewPanel.tsx für die Datei-API.
  if (ws.remote.scope === 'user') return 'user-runtime';
  const conn = s.remote[remoteConnKey(ws.remote.serverId, workspaceScopeKey(ws.remote))];
  if (!conn?.serverFeatures?.includes('tasks')) return 'server-too-old';
  return null;
}

export function tasksAvailable(
  s: Pick<StoreState, 'settings' | 'workspaces' | 'activeWorkspaceId' | 'remote'>
): boolean {
  return tasksBlockedReason(s) === null;
}

// Löst die Id einer Remote-Pane ODER eines Remote-Workspace zu dessen
// (Server, Scope) auf. Das Panel kennt mal die fokussierte Pane, mal nur den
// Workspace — beide Wege sollen auf denselben remoteTasks-Eintrag treffen.
function remoteTaskScope(
  workspaces: Workspace[],
  paneOrWorkspaceId: string
): { serverId: string; scopeKey: string } | null {
  const paneRef = parseRemotePaneKey(paneOrWorkspaceId);
  if (paneRef) return { serverId: paneRef.serverId, scopeKey: paneRef.scopeKey };
  const ws = workspaces.find((w) => w.id === paneOrWorkspaceId);
  if (ws?.kind === 'remote' && ws.remote) {
    return { serverId: ws.remote.serverId, scopeKey: workspaceScopeKey(ws.remote) };
  }
  return null;
}

const EMPTY_REMOTE_CONNECTION: RemoteConnectionState = {
  status: 'closed', clientId: null, role: null, panes: [], presence: [], deniedPaneId: null, lastError: null
};

// Backend-bewusste Pane-Freigabe: für lokale Panes beendet der Main-Prozess den
// PTY-Prozess; für Remote-Panes routet der BackendRouter denselben Aufruf auf
// RemotePtyBackend.kill = Unsubscribe — der Prozess gehört dem Projekt und
// läuft auf dem Server weiter (nie pane.close).
function releasePane(paneId: string): void {
  window.api.kill(paneId);
}

// Ist die eigene Verbindung Driver dieser (Remote-)Pane? Lokale Panes sind
// immer "Driver" — dort gibt es das Konzept nicht und Input fließt normal.
export function isPaneWritable(s: Pick<StoreState, 'remote'>, paneId: string): boolean {
  const ref = parseRemotePaneKey(paneId);
  if (!ref) return true;
  const conn = s.remote[remoteConnKey(ref.serverId, ref.scopeKey)];
  if (!conn?.clientId) return false;
  const pane = conn.panes.find((p) => p.paneId === ref.remotePaneId);
  return !!pane && pane.driver === conn.clientId;
}

// Baut aus N Remote-Panes ein ausgewogenes lokales Layout (abwechselnd h/v).
// Die Anordnung ist danach lokal frei (Plan-Entscheidung E8).
function buildRemoteLayout(paneKeys: string[], direction: Direction = 'h'): LayoutNode | null {
  if (paneKeys.length === 0) return null;
  if (paneKeys.length === 1) return { type: 'pane', id: paneKeys[0] };
  const mid = Math.ceil(paneKeys.length / 2);
  const other: Direction = direction === 'h' ? 'v' : 'h';
  return {
    type: 'split',
    id: nextSplitId(),
    direction,
    ratio: 0.5,
    children: [
      buildRemoteLayout(paneKeys.slice(0, mid), other)!,
      buildRemoteLayout(paneKeys.slice(mid), other)!
    ]
  };
}

// Fields the wizard collects when saving the active workspace as a template.
export interface SaveTemplateInput {
  name: string;
  cwd?: string; // optional override; defaults to the active workspace's cwd
  paneTitles?: Record<string, string>;
  startupCommands?: Record<string, string>;
  confirmStartupCommands: boolean;
}

export interface TemplateWizardState {
  open: boolean;
  templateId?: string | null; // set => editing an existing template; null/undefined => save current workspace
}

export interface StoreState extends AppState {
  maximizedPaneId: string | null;
  hydrated: boolean;
  settingsOpen: boolean;
  paneStatus: Record<string, PaneStatus>;
  paneCwd: Record<string, string>; // live working dir per pane (from shell OSC reports)
  paneAutoTitles: Record<string, string>; // ephemeral active command / agent prompt title per pane
  focusedPaneId: string | null;
  // Offene Rückfrage vor dem Schließen. `remote` unterscheidet nur den Text und
  // den Vollzug — der Dialog selbst ist für beide Fälle derselbe (App.tsx), damit
  // kein Einstiegspunkt still an der Rückfrage vorbeikommt.
  pendingClosePane: { paneId: string; remote: boolean } | null;
  windowFocused: boolean;
  searchOpenPaneId: string | null;
  taskView: boolean;                 // true => board visible instead of terminals
  tasks: import('../shared/types').TaskBoard | null;
  tasksDir: string | null;           // working dir the loaded board belongs to
  openTaskView: () => Promise<void>;
  closeTaskView: () => void;
  applyTasksChanged: (dir: string, board: import('../shared/types').TaskBoard) => void;
  mutateTasks: (fn: (board: import('../shared/types').TaskBoard) => import('../shared/types').TaskBoard) => void;
  runTaskInPane: (paneId: string, text: string) => void;
  runTaskInNewPane: (text: string) => void;
  commandPaletteOpen: boolean;
  templateWizard: TemplateWizardState;
  pendingTemplateLaunch: { templateId: string; workspaceId?: string } | null;
  shortcutRecordingAction: ShortcutAction | null; // set while the editor captures a key; gates global shortcuts
  previewPanel: {
    open: boolean;
    widthPx: number;
    source: PreviewSource | null;
    tab: 'files' | 'preview';
    browseRoot: string | null; // current folder shown in the Files tab
    editPath: string | null;   // file open in the inline editor (preview tab)
    // Herkunft der editierten Datei: null = lokal, sonst (Server, Projekt) —
    // damit der Editor auch nach einem Workspace-Wechsel gegen die richtige
    // Quelle lädt/speichert (editPath allein wäre für Remote mehrdeutig).
    editRemote: RemoteFilesContext | null;
  };
  openPreview: (source: PreviewSource) => void;
  closePreview: () => void;
  togglePreview: () => void;
  setPreviewWidth: (px: number) => void;
  openFiles: () => void;
  setPanelTab: (tab: 'files' | 'preview') => void;
  setBrowseRoot: (path: string) => void;
  openInEditor: (path: string, remote?: RemoteFilesContext | null) => void;
  clearEditor: () => void; // drop the inline editor (e.g. its file was deleted)
  // lifecycle
  hydrate: () => Promise<void>;
  // workspaces
  activeWorkspace: () => Workspace | undefined;
  selectWorkspace: (id: string) => void;
  addWorkspace: () => void;
  reorderWorkspace: (draggedId: string, targetId: string, position: 'before' | 'after') => void;
  renameWorkspace: (id: string, name: string) => void;
  setWorkspaceCwd: (id: string, cwd: string) => void;
  deleteWorkspace: (id: string) => void;
  // layout
  applyPreset: (kind: PresetKind) => void;
  splitActivePane: (paneId: string, direction: Direction) => void;
  requestClosePane: (paneId: string) => void;
  cancelClosePane: () => void;
  confirmClosePane: () => void;
  closeActivePane: (paneId: string) => void;
  resizeSplit: (splitId: string, ratio: number, persistNow?: boolean) => void;
  toggleMaximize: (paneId: string) => void;
  // settings
  settingsFocusSection: SettingsSection | null; // when opening, scroll to this section
  updateSettings: (patch: Partial<Settings>) => void;
  setSettingsOpen: (open: boolean, focusSection?: SettingsSection | null) => void;
  clearSettingsFocusSection: () => void;
  setPaneStatus: (paneId: string, status: PaneStatus) => void;
  setPaneCwd: (paneId: string, cwd: string) => void;
  setPaneAutoTitle: (paneId: string, title: string) => void;
  setFocusedPane: (paneId: string) => void;
  setWindowFocused: (focused: boolean) => void;
  setSearchOpen: (paneId: string | null) => void;
  setWorkspaceColor: (id: string, color: string) => void;
  setTasksEnabled: (id: string, enabled: boolean) => void;
  // command palette
  setCommandPaletteOpen: (open: boolean) => void;
  // templates
  setTemplateWizard: (state: TemplateWizardState) => void;
  setPendingTemplateLaunch: (value: { templateId: string; workspaceId?: string } | null) => void;
  saveActiveWorkspaceAsTemplate: (input: SaveTemplateInput) => void;
  updateWorkspaceTemplate: (id: string, patch: Partial<Omit<WorkspaceTemplate, 'id'>>) => void;
  deleteWorkspaceTemplate: (id: string) => void;
  requestTemplateLaunch: (id: string) => void;
  createWorkspaceFromTemplate: (id: string, includeStartupCommands: boolean) => void;
  applyTemplateToWorkspace: (workspaceId: string, templateId: string, includeStartupCommands: boolean) => void;
  launchTemplateIntoWorkspace: (workspaceId: string, templateId: string) => void;
  confirmPendingTemplateLaunch: (includeStartupCommands: boolean) => void;
  consumeStartupCommand: (paneId: string) => string | null;
  setPaneTitle: (paneId: string, title: string) => void;
  paneTitle: (paneId: string, fallback: string) => string;
  // shortcuts
  updateShortcutBinding: (action: ShortcutAction, binding: string) => void;
  resetShortcutBinding: (action: ShortcutAction) => void;
  setShortcutRecordingAction: (action: ShortcutAction | null) => void;
  // updates
  update: UpdateState;
  applyUpdateEvent: (e: UpdateEvent) => void;
  checkForUpdates: () => void;
  downloadUpdate: () => void;
  installUpdate: () => void;
  // remote workspaces
  remote: Record<string, RemoteConnectionState>; // Schlüssel: remoteConnKey()
  remoteWorkspaceDialogOpen: boolean;
  setRemoteWorkspaceDialogOpen: (open: boolean) => void;
  addServer: (name: string, baseUrl: string) => void;
  removeServer: (serverId: string) => void;
  // verbindet (Server, Scope) — ein Projekt oder die persönliche User-Runtime —
  // und legt den zugehörigen Remote-Workspace an (bzw. aktiviert einen
  // bestehenden); wirft bei Verbindungsfehlern.
  addRemoteWorkspace: (serverId: string, scope: SpawnTargetScope) => Promise<void>;
  // erneuter Verbindungsaufbau (Wecken nach 4205 / Reconnect nach kicked)
  reconnectRemote: (serverId: string, scopeKey: string) => void;
  applyRemoteStatus: (e: RemoteStatusEvent) => void;
  applyRemoteDriver: (e: RemoteDriverEvent) => void;
  applyRemotePresence: (e: RemotePresenceEvent) => void;
  createRemotePane: (paneId: string, direction?: Direction) => void;
  closeRemotePane: (paneId: string) => void;
  clearRemoteError: (serverId: string, scopeKey: string) => void;
  // geplante Agenten-Tasks (Arbeitspaket B, Aufgabe 3)
  remoteTasks: Record<string, RemoteTasksState>; // Schlüssel: remoteConnKey()
  remoteMembers: Record<string, RemoteMembersState>; // Schlüssel: remoteConnKey()
  taskLogs: Record<string, string>; // runId -> bisher empfangenes Protokoll
  tasksPanelOpen: boolean;
  loadRemoteTasks: (paneOrWorkspaceId: string) => Promise<void>;
  loadRemoteMembers: (paneOrWorkspaceId: string) => Promise<void>;
  applyRemoteTask: (e: RemoteTaskEvent) => void;
  setTasksPanelOpen: (open: boolean) => void;
  clearTaskLog: (runId: string) => void;
}

// Task-Zustand einer (Server, Scope)-Verbindung. `access` übernimmt GET
// .../tasks 1:1 vom Server (Rolle, task_manage_role, Zuweisung) — der Client
// baut die Rechteregel NICHT nach, sonst driften Oberfläche und Server beim
// nächsten Regelwechsel auseinander (siehe RemoteTaskAccess).
export interface RemoteTasksState {
  tasks: RemoteTask[];
  loading: boolean;
  // Der vollständige Fehler, nicht nur sein Code: die Servermeldung ist
  // ausgerechnet hier — wo die Liste leer bleibt — die einzige Begründung, die
  // der Nutzer bekommt. Zeilen- und Formularfehler zeigen sie längst
  // (describeTaskError im Panel), der Ladefehler warf sie bisher weg.
  error: RemoteTaskError | null;
  access: RemoteTaskAccess | null;
}

// Mitglieder einer (Server, Scope)-Verbindung — Grundlage der Zuweisung im
// Task-Formular und des Anzeigenamens in der Liste. Ein Ladefehler ist hier
// bewusst NICHT blockierend: Das Formular fällt dann auf das frühere
// Textfeld zurück, statt wegen einer Nebeninformation unbenutzbar zu werden.
export interface RemoteMembersState {
  members: RemoteProjectMember[];
  loading: boolean;
  error: RemoteTaskError | null;
}

// Obergrenze je Lauf-Protokoll (Fließtext, nicht Bytes — reicht für dieses
// Maß). Gespiegelt an der serverseitigen Grenze (256 KB, dort Kopf+Fuß mit
// Kürzungsvermerk dazwischen). Der Desktop braucht nur den Fuß: wer den
// Anfang eines langen Laufs sehen will, öffnet ihn erneut — RunLogView lädt
// dann den vollständigen Text per REST vom Server (remoteTasksGetRun), diese
// Store-Kopie bekommt nur die live nachlaufenden Zeilen.
export const TASK_LOG_MAX_CHARS = 256 * 1024;

// Der Kürzungsvermerk ist ein Nutzertext und steht deshalb in beiden
// Sprachkatalogen. Er wird beim Kürzen in den gespeicherten Text eingesetzt,
// also in der Sprache, die zu diesem Zeitpunkt gilt — ein späterer
// Sprachwechsel schreibt bereits gekürzte Protokolle nicht um. Vertretbar:
// der Text ist eine Fußnote in einem laufenden Protokoll, und ein Neuöffnen
// des Laufs (das der Vermerk gerade empfiehlt) lädt ohnehin frisch.
function taskLogTruncationNotice(): string {
  return `\n${i18n.t('tasks.scheduled.detail.logTruncated')}\n`;
}

// Hängt einen Protokoll-Chunk an und kürzt danach auf TASK_LOG_MAX_CHARS: nur
// der Fuß bleibt, mit sichtbarem Kürzungsvermerk davor. Wird bei jedem Chunk
// erneut angewandt (nicht erst am Ende), damit der Speicher während eines
// langen, geschwätzigen Laufs nie über die Grenze hinauswächst.
function appendTaskLogChunk(prev: string, chunk: string): string {
  const next = prev + chunk;
  if (next.length <= TASK_LOG_MAX_CHARS) return next;
  const notice = taskLogTruncationNotice();
  const keep = TASK_LOG_MAX_CHARS - notice.length;
  return notice + next.slice(next.length - keep);
}

// Remove a pane-keyed entry from an optional string map, returning undefined when
// the map becomes empty (so the field can be dropped). Returns the input unchanged
// when the key is absent.
function stripKey(map: Record<string, string> | undefined, key: string): Record<string, string> | undefined {
  if (!map || !(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return Object.keys(next).length ? next : undefined;
}

let saveInFlight = false;
let pendingSave: AppState | null = null;

function persistSnapshot(state: AppState): AppState {
  return {
    version: 1,
    workspaces: state.workspaces,
    workspaceTemplates: state.workspaceTemplates ?? [],
    activeWorkspaceId: state.activeWorkspaceId,
    settings: state.settings
  };
}

function flushPersist(snapshot: AppState): void {
  saveInFlight = true;
  void Promise.resolve(window.api.saveState(snapshot))
    .catch((err) => {
      console.error('Failed to save app state:', err);
    })
    .finally(() => {
      const next = pendingSave;
      pendingSave = null;
      if (next) {
        flushPersist(next);
      } else {
        saveInFlight = false;
      }
    });
}

function persist(state: AppState): void {
  const snapshot = persistSnapshot(state);
  if (saveInFlight) {
    pendingSave = snapshot;
    return;
  }
  flushPersist(snapshot);
}

// Folder the file browser should land on when it opens: the focused pane's live
// cwd (reported over OSC as the user cds around), falling back to the workspace
// folder while a fresh pane has not reported one yet. Remote workspaces browse
// the server project instead — their root is always the project root '/'
// (pane cwds there are container paths and mean nothing to the local browser).
function activeBrowseRoot(s: StoreState): string {
  const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
  if (ws?.kind === 'remote') return '/';
  const paneCwd = s.focusedPaneId ? s.paneCwd[s.focusedPaneId] : undefined;
  return paneCwd ?? ws?.cwd ?? '~';
}

export const useStore = create<StoreState>((set, get) => ({
  version: 1,
  workspaces: [],
  workspaceTemplates: [],
  activeWorkspaceId: null,
  settings: DEFAULT_SETTINGS,
  maximizedPaneId: null,
  hydrated: false,
  settingsOpen: false,
  settingsFocusSection: null,
  paneStatus: {},
  paneCwd: {},
  paneAutoTitles: {},
  focusedPaneId: null,
  pendingClosePane: null,
  windowFocused: true,
  searchOpenPaneId: null,
  taskView: false,
  tasks: null,
  tasksDir: null,
  commandPaletteOpen: false,
  templateWizard: { open: false, templateId: null },
  pendingTemplateLaunch: null,
  shortcutRecordingAction: null,
  update: { status: 'idle' },
  remote: {},
  remoteWorkspaceDialogOpen: false,
  remoteTasks: {},
  remoteMembers: {},
  taskLogs: {},
  tasksPanelOpen: false,
  previewPanel: { open: false, widthPx: 480, source: null, tab: 'files', browseRoot: null, editPath: null, editRemote: null },

  hydrate: async () => {
    const loaded = await window.api.loadState();
    const templates = loaded.workspaceTemplates ?? [];
    // Seed the id generators past ids already used by the restored layout, so the
    // next split/workspace can't reuse an existing id (which would make two panes
    // share a paneId — colliding PTYs and duplicated scrollback replay). Template
    // layouts are seeded too so cloning a template never collides with a live pane.
    nextPaneId.seed([
      ...loaded.workspaces.flatMap((w) => collectPaneIds(w.layout)),
      ...templates.flatMap((t) => collectPaneIds(t.layout))
    ]);
    nextSplitId.seed([
      ...loaded.workspaces.flatMap((w) => collectSplitIds(w.layout)),
      ...templates.flatMap((t) => collectSplitIds(t.layout))
    ]);
    nextWsId.seed(loaded.workspaces.map((w) => w.id));
    nextTemplateId.seed(templates.map((t) => t.id));
    nextServerId.seed((loaded.settings.servers ?? []).map((srv) => srv.id));
    set({ ...loaded, workspaceTemplates: templates, hydrated: true });
  },

  activeWorkspace: () => get().workspaces.find((w) => w.id === get().activeWorkspaceId),

  selectWorkspace: (id) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    if (!ws) return s;
    // Hand keyboard focus to the new workspace's first pane — the previous
    // focusedPaneId points into the old workspace, where keystrokes would go
    // nowhere visible. rAF: the pane is un-hidden (display:none -> block) first.
    const firstPane = collectPaneIds(ws.layout)[0] ?? null;
    if (firstPane) requestAnimationFrame(() => focusTerminal(firstPane));
    // Drop the file-browser folder so the Files tab re-derives it from the newly
    // active workspace's cwd, instead of clinging to the previous workspace's path.
    const next = {
      ...s,
      activeWorkspaceId: id,
      maximizedPaneId: null,
      focusedPaneId: firstPane,
      previewPanel: { ...s.previewPanel, browseRoot: null }
    };
    persist(next);
    return next;
  }),

  addWorkspace: () => {
    const ws: Workspace = {
      id: nextWsId(),
      name: `Workspace ${get().workspaces.length + 1}`,
      cwd: get().workspaces[0]?.cwd ?? '~',
      layout: null
    };
    set((s) => {
      const next = { ...s, workspaces: [...s.workspaces, ws], activeWorkspaceId: ws.id };
      persist(next);
      return next;
    });
  },

  reorderWorkspace: (draggedId, targetId, position) => set((s) => {
    if (draggedId === targetId) return s;
    const dragged = s.workspaces.find((w) => w.id === draggedId);
    const targetIndex = s.workspaces.findIndex((w) => w.id === targetId);
    if (!dragged || targetIndex < 0) return s;

    const workspaces = s.workspaces.filter((w) => w.id !== draggedId);
    const adjustedTargetIndex = workspaces.findIndex((w) => w.id === targetId);
    const insertIndex = adjustedTargetIndex + (position === 'after' ? 1 : 0);
    workspaces.splice(insertIndex, 0, dragged);

    // Dropping an item immediately beside itself can describe the order that is
    // already present. Avoid an unnecessary state update and disk write then.
    if (workspaces.every((w, index) => w.id === s.workspaces[index]?.id)) return s;

    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  renameWorkspace: (id, name) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, name } : w) };
    persist(next);
    return next;
  }),

  // Change a workspace's base directory. If it already has running panes, restart
  // them in the new directory: kill the old PTYs and remount the same layout with
  // fresh pane ids so each terminal respawns with the new cwd. (For a workspace
  // still on the welcome screen there are no panes, so this just sets the cwd.)
  setWorkspaceCwd: (id, cwd) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    // Remote-Workspaces haben kein lokales Arbeitsverzeichnis, in dem Panes
    // neu gestartet werden könnten — die Prozesse laufen auf dem Server.
    if (ws?.kind === 'remote') return s;
    if (!ws?.layout) {
      const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, cwd } : w) };
      persist(next);
      return next;
    }
    const paneStatus = { ...s.paneStatus };
    const paneCwd = { ...s.paneCwd };
    const paneAutoTitles = { ...s.paneAutoTitles };
    collectPaneIds(ws.layout).forEach((pid) => {
      releasePane(pid); delete paneStatus[pid]; delete paneCwd[pid]; delete paneAutoTitles[pid];
    });
    // Fresh pane ids force a TerminalView remount (respawn in the new cwd) —
    // pane-keyed metadata has to follow the id change or titles/pending startup
    // commands would be orphaned under the old keys and persist forever.
    const { layout, paneIdMap } = cloneTemplateLayout(ws.layout, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== id) return w;
      const nextWs: Workspace = { ...w, cwd, layout };
      const paneTitles = remapStringMap(w.paneTitles, paneIdMap);
      if (paneTitles) nextWs.paneTitles = paneTitles; else delete nextWs.paneTitles;
      const pending = remapStringMap(w.pendingStartupCommands, paneIdMap);
      if (pending) nextWs.pendingStartupCommands = pending; else delete nextWs.pendingStartupCommands;
      return nextWs;
    });
    // Hand keyboard focus to the first restarted pane — the old focusedPaneId
    // died with the old pane ids, so keystrokes would fall into <body> until a
    // click. rAF: the remounted terminal has to exist in the DOM first.
    const firstPane = collectPaneIds(layout)[0] ?? null;
    if (firstPane) requestAnimationFrame(() => focusTerminal(firstPane));
    const next = {
      ...s, workspaces, paneStatus, paneCwd, paneAutoTitles,
      maximizedPaneId: null,
      focusedPaneId: firstPane
    };
    persist(next);
    return next;
  }),

  deleteWorkspace: (id) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === id);
    const paneStatus = { ...s.paneStatus };
    const paneCwd = { ...s.paneCwd };
    const paneAutoTitles = { ...s.paneAutoTitles };
    if (ws?.layout) collectPaneIds(ws.layout).forEach((pid) => {
      releasePane(pid); delete paneStatus[pid]; delete paneCwd[pid]; delete paneAutoTitles[pid];
    });
    const remote = { ...s.remote };
    const remoteTasks = { ...s.remoteTasks };
    const remoteMembers = { ...s.remoteMembers };
    if (ws?.kind === 'remote' && ws.remote) {
      // Remote-Workspace schließen = Verbindung trennen, NICHT Prozesse killen —
      // das Projekt bzw. die User-Runtime (und ihre Panes) lebt auf dem Server weiter.
      const scopeKey = workspaceScopeKey(ws.remote);
      window.api.remoteDisconnect(ws.remote.serverId, scopeKey);
      const connKey = remoteConnKey(ws.remote.serverId, scopeKey);
      delete remote[connKey];
      // Die Task- und Mitgliederliste hängen an derselben Verbindung und gehen
      // mit ihr (siehe removeServer) — sonst blieben sie als Restmüll im Zustand liegen.
      delete remoteTasks[connKey];
      delete remoteMembers[connKey];
    }
    const workspaces = s.workspaces.filter((w) => w.id !== id);
    const activeWorkspaceId = s.activeWorkspaceId === id
      ? (workspaces[0]?.id ?? null)
      : s.activeWorkspaceId;
    const next = { ...s, workspaces, paneStatus, paneCwd, paneAutoTitles, remote, remoteTasks, remoteMembers, activeWorkspaceId, maximizedPaneId: null };
    persist(next);
    return next;
  }),

  applyPreset: (kind) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    // In Remote-Workspaces bestimmt der Server die Panes (welcome/pane.*) —
    // ein lokales Preset würde lokale Shells hineinmischen.
    if (ws?.kind === 'remote') return s;
    const layout = makePreset(kind, nextPaneId, nextSplitId);
    // A preset replaces the layout wholesale, so any pane it displaces is gone.
    // Today only the welcome screen (layout === null) can reach this, but the
    // discarded panes' PTYs would otherwise keep running in the main process
    // with nothing left to address them — unkillable until quit. Tear them down
    // and drop their pane-keyed metadata, exactly as closeActivePane does.
    const paneStatus = { ...s.paneStatus };
    const paneCwd = { ...s.paneCwd };
    const paneAutoTitles = { ...s.paneAutoTitles };
    collectPaneIds(ws?.layout ?? null).forEach((pid) => {
      releasePane(pid); delete paneStatus[pid]; delete paneCwd[pid]; delete paneAutoTitles[pid];
    });
    const workspaces = s.workspaces.map((w) =>
      w.id === s.activeWorkspaceId ? { ...w, layout } : w);
    const next = { ...s, workspaces, paneStatus, paneCwd, paneAutoTitles, maximizedPaneId: null };
    persist(next);
    return next;
  }),

  splitActivePane: (paneId, direction) => {
    const current = get();
    const active = current.workspaces.find((w) => w.id === current.activeWorkspaceId);
    if (!active?.layout || !collectPaneIds(active.layout).includes(paneId)) return;
    // Remote-Panes kommen vom Server; ein Split würde eine lokale Shell in den
    // Remote-Workspace mischen. Das Remote-Gegenstück ist ein weiteres Terminal
    // im Projekt — mit derselben Richtung, damit „rechts"/„darunter" auf jedem
    // Weg (Knopf, Tastenkürzel, Palette) dasselbe bedeutet.
    if (active.kind === 'remote') { current.createRemotePane(paneId, direction); return; }
    set((s) => {
      const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
      if (!ws?.layout) return s;
      const newPaneId = nextPaneId();
      const workspaces = s.workspaces.map((w) =>
        w.id === ws.id ? { ...w, layout: splitPane(ws.layout!, paneId, direction, newPaneId, nextSplitId()) } : w);
      // The old terminal changes width. Force one final atomic fit/PTY resize and
      // repaint after React has committed the split instead of relying solely on
      // ResizeObserver timing.
      refreshTerminalLayoutAfterCommit(paneId);
      // The new pane takes over: store focus plus DOM focus once it has mounted.
      requestAnimationFrame(() => focusTerminal(newPaneId));
      const next = { ...s, workspaces, focusedPaneId: newPaneId };
      persist(next);
      return next;
    });
  },

  // Einziger Einstieg in die Rückfrage — Kopf-Knopf, Kontextmenü, Palette und
  // Tastenkürzel laufen alle hierher, damit keiner von ihnen ohne Rückfrage
  // schließt (remote beendet das Terminal für ALLE Verbundenen).
  requestClosePane: (paneId) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws?.layout || !collectPaneIds(ws.layout).includes(paneId)) return s;
    if (!isRemotePaneKey(paneId)) return { pendingClosePane: { paneId, remote: false } };
    // Remote: nicht erst fragen und dann feststellen, dass es nicht geht — der
    // Grund erscheint sofort an der Pane (RemotePaneBar).
    const blocked = remotePaneCloseBlock(s.remote, paneId);
    if (blocked) return { remote: withRemoteError(s.remote, paneId, blocked) };
    return { pendingClosePane: { paneId, remote: true } };
  }),

  cancelClosePane: () => set({ pendingClosePane: null }),

  // Vollzug der Rückfrage: lokal über das Layout, remote über pane.close.
  confirmClosePane: () => {
    const pending = get().pendingClosePane;
    if (!pending) return;
    if (!pending.remote) { get().closeActivePane(pending.paneId); return; }
    // closeRemotePane prüft erneut — fiel die Verbindung zwischen Frage und
    // Bestätigung aus, meldet es das, statt still nichts zu tun.
    set({ pendingClosePane: null });
    get().closeRemotePane(pending.paneId);
  },

  closeActivePane: (paneId) => set((s) => {
    if (isRemotePaneKey(paneId)) return s; // Remote-Panes: siehe closeRemotePane
    releasePane(paneId);
    const paneStatus = { ...s.paneStatus }; delete paneStatus[paneId];
    const paneCwd = { ...s.paneCwd }; delete paneCwd[paneId];
    const paneAutoTitles = { ...s.paneAutoTitles }; delete paneAutoTitles[paneId];
    let successor: string | null = null;
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      const oldIds = collectPaneIds(w.layout);
      const layout = closePane(w.layout, paneId);
      // The pane that slid into the closed pane's DFS slot — its former split
      // sibling — inherits the focus.
      const remaining = collectPaneIds(layout);
      const idx = Math.max(0, oldIds.indexOf(paneId));
      successor = remaining.length > 0 ? remaining[Math.min(idx, remaining.length - 1)] : null;
      const next: Workspace = { ...w, layout };
      // Drop the closed pane's metadata so it can't orphan in persisted state
      // (mirrors the paneStatus/paneCwd cleanup above).
      const titles = stripKey(next.paneTitles, paneId);
      if (titles) next.paneTitles = titles; else delete next.paneTitles;
      const pending = stripKey(next.pendingStartupCommands, paneId);
      if (pending) next.pendingStartupCommands = pending; else delete next.pendingStartupCommands;
      return next;
    });
    const focusedPaneId = s.focusedPaneId === paneId ? successor : s.focusedPaneId;
    if (s.focusedPaneId === paneId && successor) {
      const target = successor;
      requestAnimationFrame(() => focusTerminal(target));
    }
    if (successor) refreshTerminalLayoutAfterCommit(successor);
    const next = {
      ...s,
      workspaces,
      paneStatus,
      paneCwd,
      paneAutoTitles,
      focusedPaneId,
      maximizedPaneId: s.maximizedPaneId === paneId ? null : s.maximizedPaneId,
      searchOpenPaneId: s.searchOpenPaneId === paneId ? null : s.searchOpenPaneId,
      pendingClosePane: s.pendingClosePane?.paneId === paneId ? null : s.pendingClosePane
    };
    persist(next);
    return next;
  }),

  resizeSplit: (splitId, ratio, persistNow = true) => set((s) => {
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== s.activeWorkspaceId || !w.layout) return w;
      return { ...w, layout: setRatio(w.layout, splitId, ratio) };
    });
    const next = { ...s, workspaces };
    if (persistNow) persist(next);
    return next;
  }),

  toggleMaximize: (paneId) =>
    set((s) => ({ maximizedPaneId: s.maximizedPaneId === paneId ? null : paneId })),

  updateSettings: (patch) => set((s) => {
    const next = { ...s, settings: { ...s.settings, ...patch } };
    persist(next);
    return next;
  }),

  setSettingsOpen: (open, focusSection = null) => set({ settingsOpen: open, settingsFocusSection: open ? focusSection : null }),
  clearSettingsFocusSection: () => set({ settingsFocusSection: null }),

  setPaneStatus: (paneId, status) => set((s) => {
    if (s.paneStatus[paneId] === status) return s;
    const paneStatus = { ...s.paneStatus, [paneId]: status };
    // Notify only when the pane is NOT visible (inactive workspace) OR the window
    // is unfocused — otherwise the user is already looking at it. The transition
    // into 'done' happens once until the user reacts (input resets to idle), which
    // debounces repeat notifications for the same pane. Gated on an opt-in setting
    // (default off) since OS notifications can be noisy.
    if (status === 'done' && s.settings.notificationsEnabled) {
      const ws = s.workspaces.find((w) => collectPaneIds(w.layout).includes(paneId));
      const visible = ws != null && ws.id === s.activeWorkspaceId;
      if (ws && (!visible || !s.windowFocused)) {
        // Prefer the pane's custom title, then its current automatic title and
        // live cwd; the workspace cwd is only the last resort.
        const paneTitle = ws.paneTitles?.[paneId] ?? s.paneAutoTitles[paneId] ?? s.paneCwd[paneId] ?? ws.cwd;
        window.api.notifyAgentDone({ workspaceId: ws.id, workspaceName: ws.name, paneTitle });
      }
    }
    return { ...s, paneStatus };
  }),

  setPaneCwd: (paneId, cwd) => set((s) => {
    if (s.paneCwd[paneId] === cwd) return s;
    return { ...s, paneCwd: { ...s.paneCwd, [paneId]: cwd } };
  }),

  setPaneAutoTitle: (paneId, title) => set((s) => {
    const value = title.trim();
    if ((s.paneAutoTitles[paneId] ?? '') === value) return s;
    const paneAutoTitles = { ...s.paneAutoTitles };
    if (value) paneAutoTitles[paneId] = value;
    else delete paneAutoTitles[paneId];
    return { ...s, paneAutoTitles };
  }),

  setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
  setWindowFocused: (focused) => set({ windowFocused: focused }),
  setSearchOpen: (paneId) => set({ searchOpenPaneId: paneId }),

  openTaskView: async () => {
    const ws = get().activeWorkspace();
    if (!ws) return;
    const dir = ws.cwd;
    // Bind tasksDir synchronously so edits always target the ACTIVE workspace's
    // file, even before the async load resolves (prevents writing to the previous
    // workspace's TASKS.md when switching while the board is open). Clear stale
    // tasks when the dir changes so the board shows "loading" rather than the old
    // workspace's cards.
    set((s) => ({ taskView: true, tasksDir: dir, tasks: s.tasksDir === dir ? s.tasks : null }));
    const board = await window.api.loadTasks(dir);
    // Guard against an out-of-order load if the dir changed again meanwhile.
    if (get().tasksDir === dir) set({ tasks: board });
  },
  closeTaskView: () => set({ taskView: false }),

  // Apply an external file change only when it matches the board we're showing.
  applyTasksChanged: (dir, board) => set((s) => (s.tasksDir === dir ? { tasks: board } : s)),

  // Local edit helper: transform the board, persist to TASKS.md, keep state in sync.
  mutateTasks: (fn) => set((s) => {
    if (!s.tasks || !s.tasksDir) return s;
    const tasks = fn(s.tasks);
    window.api.saveTasks(s.tasksDir, tasks);
    return { ...s, tasks };
  }),

  // Send a task's command/title into a running pane, then reveal terminals and
  // focus that pane. Uses the same input path as startup commands.
  runTaskInPane: (paneId, text) => {
    const data = `${text}\r`;
    trackTerminalInput(paneId, data);
    window.api.input({ paneId, data });
    set({ taskView: false, focusedPaneId: paneId });
    // rAF so the pane is un-hidden (display:none -> block) before we focus it.
    requestAnimationFrame(() => focusTerminal(paneId));
  },

  // Create a pane and stage the task text as a one-shot startup command, reusing
  // the proven consumeStartupCommand mechanism. Splits the focused pane (or makes
  // a single pane on the welcome screen).
  runTaskInNewPane: (text) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws || ws.kind === 'remote') return s; // Remote-Panes kommen vom Server
    const newPaneId = nextPaneId();
    let layout;
    if (!ws.layout) {
      layout = { type: 'pane', id: newPaneId } as const;
    } else {
      const ids = collectPaneIds(ws.layout);
      const target = s.focusedPaneId && ids.includes(s.focusedPaneId) ? s.focusedPaneId : ids[0];
      layout = splitPane(ws.layout, target, 'h', newPaneId, nextSplitId());
    }
    const pendingStartupCommands = { ...(ws.pendingStartupCommands ?? {}), [newPaneId]: text };
    const workspaces = s.workspaces.map((w) => w.id === ws.id ? { ...w, layout, pendingStartupCommands } : w);
    const next = { ...s, workspaces, taskView: false, focusedPaneId: newPaneId };
    persist(next);
    return next;
  }),

  openPreview: (source) => set((s) => ({
    previewPanel: { ...s.previewPanel, open: true, tab: 'preview', editPath: null, editRemote: null, source }
  })),
  closePreview: () => set((s) => ({ previewPanel: { ...s.previewPanel, open: false } })),
  // Opening (closed → open) re-syncs the browse root to where the user is
  // working; closing leaves it untouched so nothing shifts on the way out.
  togglePreview: () => set((s) => {
    const open = !s.previewPanel.open;
    if (!open) return { previewPanel: { ...s.previewPanel, open } };
    return { previewPanel: { ...s.previewPanel, open, browseRoot: activeBrowseRoot(s) } };
  }),
  setPreviewWidth: (px) => set((s) => ({
    previewPanel: { ...s.previewPanel, widthPx: Math.min(1200, Math.max(240, px)) }
  })),
  openFiles: () => set((s) => ({
    previewPanel: { ...s.previewPanel, open: true, tab: 'files', browseRoot: activeBrowseRoot(s), editPath: null, editRemote: null }
  })),
  setPanelTab: (tab) => set((s) => ({ previewPanel: { ...s.previewPanel, tab } })),
  setBrowseRoot: (path) => set((s) => ({ previewPanel: { ...s.previewPanel, browseRoot: path, editPath: null, editRemote: null } })),
  openInEditor: (path, remote = null) => set((s) => ({
    previewPanel: { ...s.previewPanel, open: true, tab: 'preview', editPath: path, editRemote: remote, source: null }
  })),
  clearEditor: () => set((s) => ({ previewPanel: { ...s.previewPanel, editPath: null, editRemote: null, tab: 'files' } })),

  setWorkspaceColor: (id, color) => set((s) => {
    const next = { ...s, workspaces: s.workspaces.map((w) => w.id === id ? { ...w, color } : w) };
    persist(next);
    return next;
  }),

  setTasksEnabled: (id, enabled) => set((s) => {
    const workspaces = s.workspaces.map((w) => w.id === id ? { ...w, tasksEnabled: enabled } : w);
    // If the active workspace just lost tasks, leave the board view.
    const taskView = s.taskView && !(s.activeWorkspaceId === id && !enabled);
    const next = { ...s, workspaces, taskView };
    persist(next);
    return next;
  }),

  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),

  setTemplateWizard: (state) => set({ templateWizard: state }),

  setPendingTemplateLaunch: (value) => set({ pendingTemplateLaunch: value }),

  // Capture the active workspace's layout/folder as a reusable template. The
  // layout is deep-copied so later edits to the live workspace don't mutate the
  // stored template; its pane ids become the template's metadata keys.
  saveActiveWorkspaceAsTemplate: (input) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws || !ws.layout) return s; // can't template the welcome screen
    const template: WorkspaceTemplate = {
      id: nextTemplateId(),
      name: input.name,
      cwd: input.cwd ?? ws.cwd,
      layout: JSON.parse(JSON.stringify(ws.layout)) as LayoutNode,
      confirmStartupCommands: input.confirmStartupCommands
    };
    if (ws.color) template.color = ws.color;
    if (input.paneTitles && Object.keys(input.paneTitles).length) template.paneTitles = input.paneTitles;
    if (input.startupCommands && Object.keys(input.startupCommands).length) template.startupCommands = input.startupCommands;
    const next = { ...s, workspaceTemplates: [...(s.workspaceTemplates ?? []), template] };
    persist(next);
    return next;
  }),

  updateWorkspaceTemplate: (id, patch) => set((s) => {
    const workspaceTemplates = (s.workspaceTemplates ?? []).map((t) => {
      if (t.id !== id) return t;
      const merged: WorkspaceTemplate = { ...t, ...patch };
      // Keep the in-memory shape identical to what persistence stores: empty
      // maps are dropped, not kept as {} (so serialize→deserialize round-trips).
      if (!merged.paneTitles || Object.keys(merged.paneTitles).length === 0) delete merged.paneTitles;
      if (!merged.startupCommands || Object.keys(merged.startupCommands).length === 0) delete merged.startupCommands;
      return merged;
    });
    const next = { ...s, workspaceTemplates };
    persist(next);
    return next;
  }),

  deleteWorkspaceTemplate: (id) => set((s) => {
    const workspaceTemplates = (s.workspaceTemplates ?? []).filter((t) => t.id !== id);
    const next = { ...s, workspaceTemplates };
    persist(next);
    return next;
  }),

  // Entry point for "New workspace from template". Defers to a confirmation
  // dialog when the template carries startup commands and asks for confirmation;
  // otherwise creates the workspace (running its commands) right away. Shared by
  // the Command Palette and Settings so the decision lives in one place.
  requestTemplateLaunch: (id) => {
    const tpl = (get().workspaceTemplates ?? []).find((t) => t.id === id);
    if (!tpl) return;
    const hasCommands = !!tpl.startupCommands && Object.keys(tpl.startupCommands).length > 0;
    if (hasCommands && tpl.confirmStartupCommands) {
      set({ pendingTemplateLaunch: { templateId: id }, commandPaletteOpen: false });
    } else {
      get().createWorkspaceFromTemplate(id, true);
      set({ commandPaletteOpen: false });
    }
  },

  // Instantiate a template: clone its layout with fresh ids, remap pane titles,
  // and (optionally) stage startup commands as one-shot pending commands that
  // each pane consumes after it spawns.
  createWorkspaceFromTemplate: (id, includeStartupCommands) => set((s) => {
    const tpl = (s.workspaceTemplates ?? []).find((t) => t.id === id);
    if (!tpl) return s;
    const { layout, paneIdMap } = cloneTemplateLayout(tpl.layout, nextPaneId, nextSplitId);
    const ws: Workspace = { id: nextWsId(), name: tpl.name, cwd: tpl.cwd, layout };
    if (tpl.color) ws.color = tpl.color;
    const paneTitles = remapStringMap(tpl.paneTitles, paneIdMap);
    if (paneTitles) ws.paneTitles = paneTitles;
    if (includeStartupCommands) {
      const pending = remapStringMap(tpl.startupCommands, paneIdMap);
      if (pending) ws.pendingStartupCommands = pending;
    }
    const next = {
      ...s,
      workspaces: [...s.workspaces, ws],
      activeWorkspaceId: ws.id,
      maximizedPaneId: null,
      focusedPaneId: null
    };
    persist(next);
    return next;
  }),

  // Fill an existing (blank) workspace from a template, in place — used by the
  // welcome screen so picking a template doesn't leave the empty workspace
  // behind. Same clone/remap rules as createWorkspaceFromTemplate. Patches in
  // place and does NOT change activeWorkspaceId — the caller targets the
  // already-active workspace. Stale optional fields are deleted when the
  // template omits them (this is why it spreads over the existing object).
  applyTemplateToWorkspace: (workspaceId, templateId, includeStartupCommands) => set((s) => {
    const tpl = (s.workspaceTemplates ?? []).find((t) => t.id === templateId);
    if (!tpl) return s;
    const { layout, paneIdMap } = cloneTemplateLayout(tpl.layout, nextPaneId, nextSplitId);
    const workspaces = s.workspaces.map((w) => {
      if (w.id !== workspaceId) return w;
      const next: Workspace = { ...w, name: tpl.name, cwd: tpl.cwd, layout };
      if (tpl.color) next.color = tpl.color; else delete next.color;
      const paneTitles = remapStringMap(tpl.paneTitles, paneIdMap);
      if (paneTitles) next.paneTitles = paneTitles; else delete next.paneTitles;
      const pending = includeStartupCommands ? remapStringMap(tpl.startupCommands, paneIdMap) : undefined;
      if (pending) next.pendingStartupCommands = pending; else delete next.pendingStartupCommands;
      return next;
    });
    const out = { ...s, workspaces, maximizedPaneId: null, focusedPaneId: null };
    persist(out);
    return out;
  }),

  // Welcome-screen entry point: fill the given blank workspace from a template,
  // routing through the confirm dialog first when the template carries startup
  // commands that ask for confirmation.
  launchTemplateIntoWorkspace: (workspaceId, templateId) => {
    const tpl = (get().workspaceTemplates ?? []).find((t) => t.id === templateId);
    if (!tpl) return;
    const hasCommands = !!tpl.startupCommands && Object.keys(tpl.startupCommands).length > 0;
    if (hasCommands && tpl.confirmStartupCommands) {
      set({ pendingTemplateLaunch: { templateId, workspaceId }, commandPaletteOpen: false });
    } else {
      get().applyTemplateToWorkspace(workspaceId, templateId, true);
      set({ commandPaletteOpen: false });
    }
  },

  // Resolve a pending launch from the confirm dialog. If it targets an existing
  // workspace (welcome-screen flow) fill it in place; otherwise create a new one.
  confirmPendingTemplateLaunch: (includeStartupCommands) => {
    const pending = get().pendingTemplateLaunch;
    if (!pending) return;
    if (pending.workspaceId) {
      get().applyTemplateToWorkspace(pending.workspaceId, pending.templateId, includeStartupCommands);
    } else {
      get().createWorkspaceFromTemplate(pending.templateId, includeStartupCommands);
    }
    set({ pendingTemplateLaunch: null });
  },

  // Return a pane's pending startup command once, then remove it (persisting so a
  // restart won't re-run it). Returns null when there's nothing pending.
  consumeStartupCommand: (paneId) => {
    const ws = get().workspaces.find((w) => w.pendingStartupCommands?.[paneId]);
    if (!ws) return null;
    const command = ws.pendingStartupCommands![paneId];
    set((s) => {
      const workspaces = s.workspaces.map((w) => {
        if (w.id !== ws.id) return w;
        const rest = { ...w.pendingStartupCommands };
        delete rest[paneId];
        const nextWs: Workspace = { ...w };
        if (Object.keys(rest).length) nextWs.pendingStartupCommands = rest;
        else delete nextWs.pendingStartupCommands;
        return nextWs;
      });
      const next = { ...s, workspaces };
      persist(next);
      return next;
    });
    return command;
  },

  // Set a workspace-local label for a pane. An empty/whitespace-only value
  // removes the label so the persisted map stays compact.
  setPaneTitle: (paneId, title) => set((s) => {
    const value = title.trim();
    const workspaces = s.workspaces.map((w) => {
      if (!w.layout || !collectPaneIds(w.layout).includes(paneId)) return w;
      if ((w.paneTitles?.[paneId] ?? '') === value) return w;
      const paneTitles = { ...(w.paneTitles ?? {}) };
      if (value) paneTitles[paneId] = value;
      else delete paneTitles[paneId];
      const next: Workspace = { ...w };
      if (Object.keys(paneTitles).length) next.paneTitles = paneTitles;
      else delete next.paneTitles;
      return next;
    });
    if (workspaces.every((w, index) => w === s.workspaces[index])) return s;
    const next = { ...s, workspaces };
    persist(next);
    return next;
  }),

  paneTitle: (paneId, fallback) => {
    const ws = get().workspaces.find((w) => w.paneTitles?.[paneId]);
    return ws?.paneTitles?.[paneId] ?? get().paneAutoTitles[paneId] ?? fallback;
  },

  updateShortcutBinding: (action, binding) => set((s) => {
    const shortcutBindings = { ...(s.settings.shortcutBindings ?? {}), [action]: binding };
    const next = { ...s, settings: { ...s.settings, shortcutBindings } };
    persist(next);
    return next;
  }),

  resetShortcutBinding: (action) => set((s) => {
    const shortcutBindings = { ...(s.settings.shortcutBindings ?? {}) };
    delete shortcutBindings[action];
    const settings: Settings = { ...s.settings };
    if (Object.keys(shortcutBindings).length) settings.shortcutBindings = shortcutBindings;
    else delete settings.shortcutBindings;
    const next = { ...s, settings };
    persist(next);
    return next;
  }),

  setShortcutRecordingAction: (action) => set({ shortcutRecordingAction: action }),

  applyUpdateEvent: (e) => set(() => {
    switch (e.type) {
      case 'checking': return { update: { status: 'checking' } };
      case 'available': return { update: { status: 'available', version: e.version } };
      case 'not-available': return { update: { status: 'not-available' } };
      case 'progress': return { update: { status: 'downloading', percent: e.percent } };
      case 'downloaded': return { update: { status: 'downloaded', version: e.version } };
      case 'error': return { update: { status: 'error', error: e.message } };
      case 'disabled': return { update: { status: 'disabled' } };
    }
  }),

  checkForUpdates: () => { set({ update: { status: 'checking' } }); window.api.checkForUpdates(); },
  downloadUpdate: () => { set({ update: { status: 'downloading', percent: 0 } }); window.api.downloadUpdate(); },
  installUpdate: () => window.api.quitAndInstall(),

  // ---- Remote-Workspaces ----------------------------------------------------

  setRemoteWorkspaceDialogOpen: (open) => set({ remoteWorkspaceDialogOpen: open }),

  addServer: (name, baseUrl) => set((s) => {
    const server: ServerConfig = { id: nextServerId(), name, baseUrl: baseUrl.replace(/\/+$/, '') };
    // Main-Registry synchron halten (dort hängen Auth und WS-Verbindungen dran).
    void window.api.serverAdd(server).catch((err: unknown) => console.error('server:add failed:', err));
    const next = { ...s, settings: { ...s.settings, servers: [...(s.settings.servers ?? []), server] } };
    persist(next);
    return next;
  }),

  removeServer: (serverId) => set((s) => {
    // Erst die Remote-Workspaces dieses Servers schließen (Panes abbestellen),
    // dann den Server samt gespeicherter Session im Main-Prozess entfernen.
    const paneStatus = { ...s.paneStatus };
    const paneCwd = { ...s.paneCwd };
    const paneAutoTitles = { ...s.paneAutoTitles };
    const remote = { ...s.remote };
    // remoteTasks/remoteMembers hängen an derselben (Server, Scope)-Verbindung
    // wie remote und werden hier mit abgeräumt — sonst blieben Task- und
    // Mitgliederliste eines entfernten Servers als Restmüll im Zustand liegen.
    const remoteTasks = { ...s.remoteTasks };
    const remoteMembers = { ...s.remoteMembers };
    const workspaces = s.workspaces.filter((w) => {
      if (w.kind !== 'remote' || w.remote?.serverId !== serverId) return true;
      collectPaneIds(w.layout).forEach((pid) => {
        releasePane(pid); delete paneStatus[pid]; delete paneCwd[pid]; delete paneAutoTitles[pid];
      });
      const connKey = remoteConnKey(serverId, workspaceScopeKey(w.remote));
      delete remote[connKey];
      delete remoteTasks[connKey];
      delete remoteMembers[connKey];
      return false;
    });
    void window.api.serverRemove(serverId).catch((err: unknown) => console.error('server:remove failed:', err));
    const servers = (s.settings.servers ?? []).filter((srv) => srv.id !== serverId);
    const settings: Settings = { ...s.settings };
    if (servers.length) settings.servers = servers; else delete settings.servers;
    const activeWorkspaceId = workspaces.some((w) => w.id === s.activeWorkspaceId)
      ? s.activeWorkspaceId
      : (workspaces[0]?.id ?? null);
    const next = { ...s, workspaces, settings, remote, remoteTasks, remoteMembers, paneStatus, paneCwd, paneAutoTitles, activeWorkspaceId };
    persist(next);
    return next;
  }),

  addRemoteWorkspace: async (serverId, scope) => {
    // Verbindet (bzw. weckt) die Verbindung und wartet auf das welcome; wirft
    // bei Fehlern — der Dialog zeigt die Meldung an. scope 'user' verbindet
    // mit der persönlichen User-Runtime (?scope=user) statt einem Projekt.
    const scopeKey = remoteScopeKey(scope);
    const info = await window.api.remoteConnectWorkspace(serverId, scopeKey);
    set((s) => {
      const key = remoteConnKey(serverId, scopeKey);
      const remote = {
        ...s.remote,
        [key]: {
          ...(s.remote[key] ?? EMPTY_REMOTE_CONNECTION),
          status: 'connected' as const,
          clientId: info.clientId || null,
          role: info.role,
          panes: info.panes,
          serverFeatures: info.features
        }
      };
      const existing = s.workspaces.find(
        (w) => w.kind === 'remote' && w.remote?.serverId === serverId && workspaceScopeKey(w.remote) === scopeKey
      );
      if (existing) {
        // Denselben Remote-Workspace nicht doppelt anlegen — nur aktivieren;
        // den Pane-Abgleich übernimmt der folgende panes-Push.
        const next = { ...s, remote, activeWorkspaceId: existing.id, remoteWorkspaceDialogOpen: false };
        persist(next);
        return next;
      }
      const layout = buildRemoteLayout(
        info.panes.map((p) => remotePaneKey(serverId, scopeKey, p.paneId))
      );
      const ws: Workspace = {
        id: nextWsId(),
        // Anzeigename aus dem welcome (Projektname bzw. „Meine Umgebung").
        name: info.projectName || scopeKey,
        cwd: '~',
        layout,
        kind: 'remote',
        remote: scope.kind === 'user'
          ? { serverId, scope: 'user' }
          : { serverId, scope: 'project', projectId: scope.projectId }
      };
      const next = {
        ...s,
        remote,
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
        maximizedPaneId: null,
        focusedPaneId: null,
        remoteWorkspaceDialogOpen: false
      };
      persist(next);
      return next;
    });
  },

  reconnectRemote: (serverId, scopeKey) => {
    // Wecken (4205) bzw. erneuter Versuch nach kicked/closed. Das Ergebnis
    // kommt als remote:status-Push zurück; Fehler nur loggen — die Statusleiste
    // zeigt den Zustand ohnehin an.
    set((s) => {
      const key = remoteConnKey(serverId, scopeKey);
      return {
        remote: { ...s.remote, [key]: { ...(s.remote[key] ?? EMPTY_REMOTE_CONNECTION), status: 'connecting' } }
      };
    });
    window.api.remoteConnectWorkspace(serverId, scopeKey).catch((err: unknown) => {
      console.error('remote reconnect failed:', err);
    });
  },

  applyRemoteStatus: (e) => set((s) => {
    const key = remoteConnKey(e.serverId, e.scopeKey);
    const prev = s.remote[key] ?? EMPTY_REMOTE_CONNECTION;
    if (e.kind === 'connection') {
      // Ein Statuswechsel (reconnecting/connected/…) macht eine alte Ablehnung
      // ungültig — sie bezog sich auf den vorigen Verbindungszustand. Ohne das
      // bliebe „nur lesend" z. B. nach einem Reconnect mit neuer Rolle stehen,
      // obwohl seither nichts mehr abgelehnt wurde.
      return { ...s, remote: { ...s.remote, [key]: { ...prev, status: e.status, lastError: null } } };
    }
    if (e.kind === 'error') {
      // Vom Server abgelehnte Aktion (z. B. forbidden) — kein Verbindungsabbruch,
      // nur eine Meldung für die auslösende Stelle (RemotePaneBar). Sie räumt sich
      // auf drei Wegen wieder ab: nach REMOTE_ERROR_TTL_MS (Zeitstempel `at`),
      // bei der nächsten gelungenen Aktion und sobald ein Panes- oder
      // Verbindungs-Ereignis zeigt, dass der alte Zustand überholt ist.
      return {
        ...s,
        remote: { ...s.remote, [key]: { ...prev, lastError: { code: e.code, paneId: e.paneId, at: Date.now() } } }
      };
    }
    // kind === 'panes': Verbindungszustand aktualisieren und das Layout des
    // zugehörigen Remote-Workspace nachziehen — pane.added ergänzt, pane.removed
    // entfernt; die Anordnung vorhandener Panes bleibt unangetastet (E8).
    const remote = {
      ...s.remote,
      [key]: {
        ...prev, clientId: e.clientId ?? prev.clientId, role: e.role ?? prev.role, panes: e.panes,
        serverFeatures: e.features ?? prev.serverFeatures,
        lastError: null
      }
    };
    const ws = s.workspaces.find(
      (w) => w.kind === 'remote' && w.remote?.serverId === e.serverId && workspaceScopeKey(w.remote) === e.scopeKey
    );
    if (!ws) return { ...s, remote };
    const wanted = e.panes.map((p) => remotePaneKey(e.serverId, e.scopeKey, p.paneId));
    let layout = ws.layout;
    for (const pid of collectPaneIds(layout)) {
      if (isRemotePaneKey(pid) && !wanted.includes(pid)) {
        layout = layout ? closePane(layout, pid) : null;
      }
    }
    // Ein eigener Klick auf „rechts"/„darunter" hat einen Anker und eine
    // Richtung hinterlegt (createRemotePane). Sie gelten für die ERSTE neue Pane
    // dieses Pushes — danach fällt die Platzierung wieder auf den Anhang rechts
    // zurück, damit fremde pane.added nicht ebenfalls dorthin springen.
    let placement = prev.pendingPlacement ?? null;
    if (placement && Date.now() - placement.at > REMOTE_PLACEMENT_TTL_MS) placement = null;
    let placedPaneId: string | null = null;
    for (const pid of wanted) {
      if (collectPaneIds(layout).includes(pid)) continue;
      if (!layout) {
        layout = { type: 'pane', id: pid };
      } else {
        const ids = collectPaneIds(layout);
        const anchor = placement && ids.includes(placement.anchorPaneId)
          ? placement.anchorPaneId
          : ids[ids.length - 1];
        const direction = placement && ids.includes(placement.anchorPaneId) ? placement.direction : 'h';
        layout = splitPane(layout, anchor, direction, pid, nextSplitId());
      }
      if (placement) { placedPaneId = pid; placement = null; }
    }
    if (prev.pendingPlacement) remote[key] = { ...remote[key], pendingPlacement: null };
    if (layout === ws.layout) return { ...s, remote };
    const workspaces = s.workspaces.map((w) => (w.id === ws.id ? { ...w, layout } : w));
    // Wie beim lokalen Split übernimmt die neue Pane — aber nur, wenn sie aus
    // dem eigenen Klick stammt; sonst risse eine fremde Pane den Fokus weg.
    const focusPaneId = placedPaneId;
    if (focusPaneId) requestAnimationFrame(() => focusTerminal(focusPaneId));
    const next = {
      ...s, remote, workspaces,
      focusedPaneId: placedPaneId ?? s.focusedPaneId
    };
    persist(next);
    return next;
  }),

  applyRemoteDriver: (e) => set((s) => {
    const key = remoteConnKey(e.serverId, e.scopeKey);
    const prev = s.remote[key];
    if (!prev) return s;
    const panes = prev.panes.map((p) =>
      p.paneId === e.paneId
        ? { ...p, driver: e.driver, driverQueue: e.driverQueue, queueDeadline: e.queueDeadline }
        : p
    );
    const deniedPaneId = e.denied ? e.paneId : (prev.deniedPaneId === e.paneId ? null : prev.deniedPaneId);
    return {
      ...s,
      remote: { ...s.remote, [key]: { ...prev, panes, clientId: e.clientId ?? prev.clientId, deniedPaneId } }
    };
  }),

  applyRemotePresence: (e) => set((s) => {
    const key = remoteConnKey(e.serverId, e.scopeKey);
    const prev = s.remote[key] ?? EMPTY_REMOTE_CONNECTION;
    return { ...s, remote: { ...s.remote, [key]: { ...prev, presence: e.users } } };
  }),

  // Das Layout fassen beide Aktionen nicht an: es ändert sich erst, wenn der
  // Server pane.added bzw. pane.removed schickt — genau ein Pfad, egal ob
  // Desktop oder Browser ausgelöst hat. Gesetzt wird hier nur der Fehlerslot,
  // damit eine blockierte Aktion nicht still endet.
  createRemotePane: (paneId, direction = 'h') => {
    const ref = parseRemotePaneKey(paneId);
    if (!ref) return;
    const blocked = remotePaneCreateBlock(get().remote, paneId);
    if (blocked) { set((s) => ({ remote: withRemoteError(s.remote, paneId, blocked) })); return; }
    // Der Wunsch „rechts" bzw. „darunter" wird hier hinterlegt und erst beim
    // panes-Push eingelöst — das Layout ändert sich weiterhin nur auf einem Weg.
    set((s) => {
      const key = remoteConnKey(ref.serverId, ref.scopeKey);
      const conn = withoutRemoteError(s.remote, paneId)[key];
      if (!conn) return { remote: withoutRemoteError(s.remote, paneId) };
      return {
        remote: {
          ...withoutRemoteError(s.remote, paneId),
          [key]: { ...conn, pendingPlacement: { anchorPaneId: paneId, direction, at: Date.now() } }
        }
      };
    });
    window.api.remotePaneCreate(ref.serverId, ref.scopeKey);
  },

  closeRemotePane: (paneId) => {
    const ref = parseRemotePaneKey(paneId);
    if (!ref) return;
    const blocked = remotePaneCloseBlock(get().remote, paneId);
    if (blocked) { set((s) => ({ remote: withRemoteError(s.remote, paneId, blocked) })); return; }
    set((s) => ({ remote: withoutRemoteError(s.remote, paneId) }));
    window.api.remotePaneClose(ref.serverId, ref.scopeKey, ref.remotePaneId);
  },

  // Abräumen der Meldung nach Ablauf der Anzeigedauer (RemotePaneBar stellt den
  // Wecker) — ohne das bliebe eine einmalige Ablehnung dauerhaft im Zustand.
  clearRemoteError: (serverId, scopeKey) => set((s) => {
    const key = remoteConnKey(serverId, scopeKey);
    const conn = s.remote[key];
    if (!conn?.lastError) return s;
    return { remote: { ...s.remote, [key]: { ...conn, lastError: null } } };
  }),

  // ---- Geplante Agenten-Tasks (Arbeitspaket B, Aufgabe 3) --------------------

  loadRemoteTasks: async (paneOrWorkspaceId) => {
    const ref = remoteTaskScope(get().workspaces, paneOrWorkspaceId);
    if (!ref) return;
    const key = remoteConnKey(ref.serverId, ref.scopeKey);
    set((s) => {
      const prev = s.remoteTasks[key];
      return {
        remoteTasks: {
          ...s.remoteTasks,
          [key]: { tasks: prev?.tasks ?? [], access: prev?.access ?? null, loading: true, error: null }
        }
      };
    });
    const result = await window.api.remoteTasksList(ref.serverId, ref.scopeKey);
    set((s) => {
      const prev = s.remoteTasks[key];
      return {
        remoteTasks: {
          ...s.remoteTasks,
          [key]: result.ok
            ? { tasks: result.tasks, access: result.access, loading: false, error: null }
            // Ein Fehlversuch verwirft nicht die zuletzt bekannte Liste — das Panel
            // zeigt weiterhin die alten Tasks samt Fehlermeldung, statt leerzulaufen.
            : { tasks: prev?.tasks ?? [], access: prev?.access ?? null, loading: false, error: result }
        }
      };
    });
  },

  loadRemoteMembers: async (paneOrWorkspaceId) => {
    const ref = remoteTaskScope(get().workspaces, paneOrWorkspaceId);
    if (!ref) return;
    const key = remoteConnKey(ref.serverId, ref.scopeKey);
    set((s) => ({
      remoteMembers: {
        ...s.remoteMembers,
        [key]: { members: s.remoteMembers[key]?.members ?? [], loading: true, error: null }
      }
    }));
    const result = await window.api.remoteMembersList(ref.serverId, ref.scopeKey);
    set((s) => ({
      remoteMembers: {
        ...s.remoteMembers,
        [key]: result.ok
          ? { members: result.members, loading: false, error: null }
          // Wie bei den Tasks: ein Fehlversuch verwirft nicht die zuletzt
          // bekannte Liste, sonst verlöre ein offenes Formular seine Auswahl.
          : { members: s.remoteMembers[key]?.members ?? [], loading: false, error: result }
      }
    }));
  },

  // Verarbeitet die vier Ereignis-Arten von remote:task (siehe RemoteTaskEvent).
  // Ereignisse einer nicht (mehr) bekannten Verbindung werden ignoriert — sonst
  // legt ein spätes oder verirrtes Push einen leeren Eintrag an, den niemand
  // mehr abräumt (kein Anlegen leerer Einträge).
  applyRemoteTask: (e) => set((s) => {
    const key = remoteConnKey(e.serverId, e.scopeKey);
    if (!s.remote[key]) return s;

    if (e.kind === 'log') {
      const taskLogs = { ...s.taskLogs, [e.runId]: appendTaskLogChunk(s.taskLogs[e.runId] ?? '', e.chunk) };
      return { ...s, taskLogs };
    }

    const entry = s.remoteTasks[key] ?? { tasks: [], loading: false, error: null, access: null };
    let tasks = entry.tasks;
    if (e.kind === 'changed') {
      // Die Live-Nachricht führt kein lastRun (siehe RemoteTaskEvent). Der
      // zuletzt bekannte Lauf des vorhandenen Tasks bleibt deshalb stehen —
      // sonst verlöre z. B. ein Pausieren während eines Laufs die Anzeige
      // „Letzter Lauf", und weil danach kein Task mehr als laufend gilt,
      // wären alle Starten-Knöpfe wieder frei; der nächste Klick liefe in
      // einen 409. Genau so führt der Web-Client zusammen (TasksPanel.tsx).
      // Neu hinzukommende Tasks haben noch keinen Lauf: null.
      const idx = tasks.findIndex((t) => t.id === e.task.id);
      tasks = idx >= 0
        ? tasks.map((t, i) => (i === idx ? { ...e.task, lastRun: t.lastRun } : t))
        : [...tasks, { ...e.task, lastRun: null }];
    } else if (e.kind === 'removed') {
      tasks = tasks.filter((t) => t.id !== e.taskId);
    } else {
      // kind === 'run': gestartete/abgeschlossene Läufe spiegeln sich im
      // lastRun des betroffenen Tasks, ohne die Liste neu zu laden.
      tasks = tasks.map((t) => (t.id === e.run.taskId ? { ...t, lastRun: e.run } : t));
    }
    return { ...s, remoteTasks: { ...s.remoteTasks, [key]: { ...entry, tasks } } };
  }),

  setTasksPanelOpen: (open) => set({ tasksPanelOpen: open }),

  // Räumt das gespeicherte Protokoll eines einzelnen Laufs ab. Naheliegender
  // Aufrufzeitpunkt ist das Abmelden vom Live-Protokoll: RunLogView meldet
  // sich beim Verlassen eines Laufs über window.api.remoteTaskLogUnsubscribe
  // ab, aber das läuft direkt am IPC vorbei am Store — der Store erfährt
  // davon heute nicht von selbst (kein Aufruf einer Store-Aktion an dieser
  // Stelle). Diese Aktion ist die Store-seitige Hälfte dafür, im selben
  // Muster wie clearRemoteError: der Store bietet das Aufräumen an, die
  // aufrufende Stelle (RunLogView) entscheidet den Zeitpunkt — dort fehlt
  // noch der Aufruf, siehe Fix-Runde-1-Bericht.
  clearTaskLog: (runId) => set((s) => {
    if (!(runId in s.taskLogs)) return s;
    const taskLogs = { ...s.taskLogs };
    delete taskLogs[runId];
    return { taskLogs };
  })
}));
