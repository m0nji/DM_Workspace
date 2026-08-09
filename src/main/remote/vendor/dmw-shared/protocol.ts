// AUTO-GENERIERT aus dm_workspace_web@05bf9ad — nicht editieren, npm run sync:dmw-client

/**
 * WebSocket-Protokoll zwischen Browser und DM Workspace Web Server.
 *
 * Jede Nachricht ist ein JSON-Objekt mit einem `type`-Feld. Output-Daten
 * tragen eine monoton steigende Sequenznummer pro Pane, damit ein Client
 * nach einem Reconnect verlustfrei ab seiner letzten Nummer fortsetzen kann.
 */

/**
 * Aktuelle Protokollversion. v2 ist rein additiv zu v1: `welcome` enthält
 * zusätzlich `serverInfo` und `scope` – v1-Clients ignorieren die Felder als
 * unbekannte JSON-Zusatzfelder und bleiben funktionsfähig.
 */
export const PROTOCOL_VERSION = 2

/** Vom Server akzeptierte hello-Versionen (abwärtskompatibel zu v1). */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1, 2]

/** true, wenn der Server diese hello-Version bedienen kann. */
export function isSupportedProtocolVersion(version: number): boolean {
  return SUPPORTED_PROTOCOL_VERSIONS.includes(version)
}

/** Maximale Größe einer einzelnen Client-Nachricht in Bytes. */
export const MAX_MESSAGE_BYTES = 64 * 1024
/** Maximale Input-Nachrichten pro Sekunde und Verbindung. */
export const MAX_INPUT_MESSAGES_PER_SECOND = 200

export type PaneId = string

export interface UserInfo {
  /** Kurzlebige, serverseitig vergebene Verbindungs-ID. */
  clientId: string
  /** Anzeigename (Phase 1: frei gewählt, ab Phase 2 aus der Identität). */
  name: string
  color: string
}

export interface PresenceEntry extends UserInfo {
  /** Pane, das der Nutzer zuletzt fokussiert hat (null = keins). */
  activePane: PaneId | null
}

export interface PaneInfo {
  paneId: PaneId
  title: string
  cols: number
  rows: number
  /** clientId des aktuellen Drivers oder null. */
  driver: string | null
  /** Wartende Driver-Anfragen in Reihenfolge. */
  driverQueue: string[]
  /** Zeitpunkt (Epoch ms), zu dem die vorderste Anfrage automatisch übergeben wird. */
  queueDeadline: number | null
  running: boolean
}

/**
 * Stammdaten eines geplanten Agenten-Tasks (ohne Laufhistorie). Zeitangaben
 * sind ISO-8601-Strings, damit sie ohne Zusatzlogik JSON-serialisierbar sind.
 */
export interface TaskInfo {
  id: string
  projectId: string
  name: string
  description: string
  ownerId: string | null
  agent: 'claude' | 'codex' | 'opencode'
  prompt: string
  workdir: string
  scheduleKind: 'cron' | 'interval' | 'manual'
  scheduleExpr: string
  timezone: string
  timeoutMs: number
  enabled: boolean
  nextRunAt: string | null
}

/** Ein einzelner Lauf eines Tasks. */
export interface TaskRunInfo {
  id: string
  taskId: string
  status: 'running' | 'success' | 'failed' | 'timeout' | 'cancelled' | 'skipped' | 'interrupted'
  trigger: 'schedule' | 'manual'
  startedBy: string | null
  startedAt: string
  finishedAt: string | null
  exitCode: number | null
}

// ---------------------------------------------------------------------------
// Client → Server
// ---------------------------------------------------------------------------

export interface HelloMessage {
  type: 'hello'
  protocol: number
  name: string
  /** Bei Reconnect: vorherige clientId, um Presence-Identität zu behalten. */
  resumeClientId?: string
}

export interface SubscribeMessage {
  type: 'subscribe'
  paneId: PaneId
  /** Letzte gesehene Sequenznummer; Server sendet alles danach erneut. */
  sinceSeq?: number
}

export interface UnsubscribeMessage {
  type: 'unsubscribe'
  paneId: PaneId
}

export interface InputMessage {
  type: 'input'
  paneId: PaneId
  data: string
}

export interface ResizeMessage {
  type: 'resize'
  paneId: PaneId
  cols: number
  rows: number
}

export interface DriverRequestMessage {
  type: 'driver.request'
  paneId: PaneId
}

export interface DriverReleaseMessage {
  type: 'driver.release'
  paneId: PaneId
}

/** Aktueller Driver bestätigt eine wartende Anfrage (sofortige Übergabe). */
export interface DriverApproveMessage {
  type: 'driver.approve'
  paneId: PaneId
  clientId: string
}

/** Aktueller Driver lehnt eine wartende Anfrage ab. */
export interface DriverDenyMessage {
  type: 'driver.deny'
  paneId: PaneId
  clientId: string
}

export interface FocusMessage {
  type: 'focus'
  paneId: PaneId | null
}

/** Neues Terminal-Pane anlegen (gemeinsames Layout, Editor/Owner). */
export interface PaneCreateMessage {
  type: 'pane.create'
}

/** Terminal-Pane für alle schließen (Editor/Owner). */
export interface PaneCloseMessage {
  type: 'pane.close'
  paneId: PaneId
}

/** Live-Protokollzeilen eines laufenden Task-Runs abonnieren (lesend, auch für Viewer). */
export interface TaskLogSubscribeMessage {
  type: 'task.log.subscribe'
  runId: string
}

/** Abonnement der Protokollzeilen eines Task-Runs wieder aufheben. */
export interface TaskLogUnsubscribeMessage {
  type: 'task.log.unsubscribe'
  runId: string
}

export type ClientMessage =
  | HelloMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | InputMessage
  | ResizeMessage
  | DriverRequestMessage
  | DriverReleaseMessage
  | DriverApproveMessage
  | DriverDenyMessage
  | FocusMessage
  | PaneCreateMessage
  | PaneCloseMessage
  | TaskLogSubscribeMessage
  | TaskLogUnsubscribeMessage

// ---------------------------------------------------------------------------
// Server → Client
// ---------------------------------------------------------------------------

export type ProjectRole = 'owner' | 'editor' | 'viewer'

/** Zusatzinfos über den Server, ab Protokoll v2 im `welcome`. */
export interface ServerInfo {
  /** Server-Version (aus der package.json des Servers). */
  version: string
  /** Höchste vom Server unterstützte Protokollversion. */
  protocolVersion: number
  /**
   * Zusätzliche Fähigkeiten dieses Servers, z. B. 'tasks' für geplante
   * Agenten-Tasks. Additiv: Clients, die einen Wert nicht kennen, ignorieren
   * ihn; ältere Server senden das Feld gar nicht. PROTOCOL_VERSION bleibt 2.
   */
  features?: string[]
}

/**
 * Geltungsbereich einer Verbindung. Projekt-Scope: geteilte Projekt-Runtime
 * (Phase A). Benutzer-Scope (Phase D): die isolierte, persönliche Runtime des
 * angemeldeten Nutzers – bewusst ohne ID, der Scope ist immer der eigene
 * Nutzer (fremde User-Runtimes sind nicht adressierbar). Die Ergänzung ist
 * rein additiv, PROTOCOL_VERSION bleibt 2.
 */
export interface ProjectScope {
  kind: 'project'
  projectId: string
}

export interface UserScope {
  kind: 'user'
}

export type ConnectionScope = ProjectScope | UserScope

export interface WelcomeMessage {
  type: 'welcome'
  /** Ausgehandelte Protokollversion (die vom Client im hello gewünschte). */
  protocol: number
  clientId: string
  projectName: string
  /** Rolle des angemeldeten Nutzers in diesem Projekt. */
  role: ProjectRole
  panes: PaneInfo[]
  /** Ab Protokoll v2 – ältere Server senden das Feld nicht. */
  serverInfo?: ServerInfo
  /** Geltungsbereich der Verbindung, ab Protokoll v2. */
  scope?: ConnectionScope
}

export interface OutputMessage {
  type: 'output'
  paneId: PaneId
  seq: number
  data: string
}

export interface ScrollbackMessage {
  type: 'scrollback'
  paneId: PaneId
  /** Sequenznummer des letzten enthaltenen Chunks. */
  seq: number
  /** true, wenn älterer Verlauf abgeschnitten wurde (Puffergrenze). */
  truncated: boolean
  data: string
}

export interface DriverChangedMessage {
  type: 'driver.changed'
  paneId: PaneId
  driver: string | null
  driverQueue: string[]
  /** Auto-Übergabe-Zeitpunkt (Epoch ms) der vordersten Anfrage. */
  queueDeadline: number | null
}

/** Die eigene Driver-Anfrage wurde vom aktuellen Driver abgelehnt. */
export interface DriverDeniedMessage {
  type: 'driver.denied'
  paneId: PaneId
}

export interface PresenceMessage {
  type: 'presence'
  users: PresenceEntry[]
}

export interface PaneStateMessage {
  type: 'pane.state'
  pane: PaneInfo
}

export interface PaneAddedMessage {
  type: 'pane.added'
  pane: PaneInfo
}

export interface PaneRemovedMessage {
  type: 'pane.removed'
  paneId: PaneId
}

export interface ExitMessage {
  type: 'exit'
  paneId: PaneId
  exitCode: number
}

export interface ErrorMessage {
  type: 'error'
  code:
    | 'bad_message'
    | 'not_driver'
    | 'unknown_pane'
    | 'rate_limited'
    | 'protocol_mismatch'
    | 'forbidden'
    | 'pane_limit'
    | 'last_pane'
  message: string
  paneId?: PaneId
}

/** Ein Task wurde angelegt oder geändert (Stammdaten, kein Lauf). */
export interface TaskChangedMessage {
  type: 'task.changed'
  task: TaskInfo
}

/** Ein Task wurde gelöscht. */
export interface TaskRemovedMessage {
  type: 'task.removed'
  taskId: string
}

/** Ein Lauf wurde gestartet (manuell oder per Zeitplan). */
export interface TaskRunStartedMessage {
  type: 'task.run.started'
  run: TaskRunInfo
}

/** Eine Protokollzeile eines laufenden Runs (nur für abonnierte Clients). */
export interface TaskRunLogMessage {
  type: 'task.run.log'
  runId: string
  data: string
}

/** Ein Lauf ist abgeschlossen (Erfolg, Fehler, Timeout, Abbruch, …). */
export interface TaskRunFinishedMessage {
  type: 'task.run.finished'
  run: TaskRunInfo
}

export type ServerMessage =
  | WelcomeMessage
  | OutputMessage
  | ScrollbackMessage
  | DriverChangedMessage
  | DriverDeniedMessage
  | PresenceMessage
  | PaneStateMessage
  | PaneAddedMessage
  | PaneRemovedMessage
  | ExitMessage
  | ErrorMessage
  | TaskChangedMessage
  | TaskRemovedMessage
  | TaskRunStartedMessage
  | TaskRunLogMessage
  | TaskRunFinishedMessage

// ---------------------------------------------------------------------------
// Validierung
// ---------------------------------------------------------------------------

const CLIENT_TYPES = new Set([
  'hello',
  'subscribe',
  'unsubscribe',
  'input',
  'resize',
  'driver.request',
  'driver.release',
  'driver.approve',
  'driver.deny',
  'focus',
  'pane.create',
  'pane.close',
  'task.log.subscribe',
  'task.log.unsubscribe',
])

function isNonEmptyString(v: unknown, max = 256): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max
}

function isDim(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 2 && v <= 500
}

/**
 * Parst und validiert eine rohe Client-Nachricht. Gibt null zurück, wenn die
 * Nachricht kein gültiges Protokoll-Objekt ist.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > MAX_MESSAGE_BYTES) return null
  let msg: unknown
  try {
    msg = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof msg !== 'object' || msg === null) return null
  const m = msg as Record<string, unknown>
  if (typeof m.type !== 'string' || !CLIENT_TYPES.has(m.type)) return null

  switch (m.type) {
    case 'hello':
      // Die Version wird hier nur strukturell geprüft (positive Ganzzahl).
      // Ob sie unterstützt wird, entscheidet der Server – so bekommt ein
      // neuerer Client ein aussagekräftiges `protocol_mismatch` statt eines
      // generischen `bad_message`.
      if (typeof m.protocol !== 'number' || !Number.isInteger(m.protocol) || m.protocol < 1) return null
      if (!isNonEmptyString(m.name, 64)) return null
      if (m.resumeClientId !== undefined && !isNonEmptyString(m.resumeClientId, 64)) return null
      return m as unknown as HelloMessage
    case 'subscribe':
      if (!isNonEmptyString(m.paneId)) return null
      if (m.sinceSeq !== undefined && (typeof m.sinceSeq !== 'number' || m.sinceSeq < 0)) return null
      return m as unknown as SubscribeMessage
    case 'unsubscribe':
    case 'driver.request':
    case 'driver.release':
    case 'pane.close':
      return isNonEmptyString(m.paneId) ? (m as unknown as ClientMessage) : null
    case 'driver.approve':
    case 'driver.deny':
      return isNonEmptyString(m.paneId) && isNonEmptyString(m.clientId, 64)
        ? (m as unknown as ClientMessage)
        : null
    case 'pane.create':
      return m as unknown as PaneCreateMessage
    case 'input':
      if (!isNonEmptyString(m.paneId)) return null
      if (typeof m.data !== 'string' || m.data.length === 0 || m.data.length > MAX_MESSAGE_BYTES) return null
      return m as unknown as InputMessage
    case 'resize':
      if (!isNonEmptyString(m.paneId)) return null
      if (!isDim(m.cols) || !isDim(m.rows)) return null
      return m as unknown as ResizeMessage
    case 'focus':
      if (m.paneId !== null && !isNonEmptyString(m.paneId)) return null
      return m as unknown as FocusMessage
    case 'task.log.subscribe':
    case 'task.log.unsubscribe':
      return isNonEmptyString(m.runId) ? (m as unknown as ClientMessage) : null
    default:
      return null
  }
}
