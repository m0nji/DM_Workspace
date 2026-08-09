// AUTO-GENERIERT aus dm_workspace_web@05bf9ad — nicht editieren, npm run sync:dmw-client

import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ConnectionScope,
  type PaneId,
  type ServerInfo,
  type ServerMessage,
} from '@dmw/shared'

export type MessageListener = (msg: ServerMessage) => void
export type StatusListener = (status: ConnectionStatus) => void
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'closed'
  | 'kicked'
  | 'runtime-stopped'

/**
 * Minimale strukturelle Sicht auf einen WebSocket – bewusst ohne DOM-Typen,
 * damit das Paket in Browser, Electron-Main und Node nutzbar ist. Sowohl der
 * Browser-`WebSocket` als auch `ws` aus npm erfüllen dieses Interface (bei
 * Bedarf per Cast in der Factory, siehe {@link WebSocketFactory}).
 */
export interface WebSocketLike {
  readyState: number
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: (() => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
}

/**
 * Erzeugt die WebSocket-Verbindung für eine (vollständige) WS-URL.
 *
 * `headers` sind optionale Zusatz-Header für den HTTP-Upgrade-Request
 * (z. B. ein Cookie-Header, wenn Electron-Main die Verbindung aufbaut).
 * Der Browser-`WebSocket` kann keine Header setzen – die Default-Factory
 * ignoriert sie deshalb; eine Node-Factory reicht sie an `ws` weiter:
 * `(url, headers) => new WebSocket(url, { headers })`.
 */
export type WebSocketFactory = (url: string, headers?: Record<string, string>) => WebSocketLike

/**
 * Verbindungsziel: ein Projekt (geteilte Runtime) oder die persönliche
 * User-Runtime des angemeldeten Nutzers (`?scope=user`, ohne ID – der Scope
 * ist serverseitig immer der eigene Nutzer).
 */
export type WorkspaceTarget = { kind: 'project'; projectId: string } | { kind: 'user' }

export interface WorkspaceClientOptions {
  /**
   * Basis-URL des Servers, z. B. `wss://dmw.example` oder `ws://127.0.0.1:8791`.
   * Der Client hängt selbst `/ws?project=…` an.
   */
  url: string
  /**
   * Liefert die WebSocket-Implementierung. Default: `globalThis.WebSocket`
   * (Browser); in Umgebungen ohne globalen WebSocket muss eine Factory
   * übergeben werden.
   */
  webSocketFactory?: WebSocketFactory
  /** Zusatz-Header für den Upgrade-Request, siehe {@link WebSocketFactory}. */
  headers?: Record<string, string>
  /**
   * true: Die WS-URL nutzt `?scope=project:<id>` statt `?project=<id>`
   * (gleichwertige Aliasse ab Protokoll v2). Default false – kompatibel zu
   * Servern vor v2.
   */
  useScopeQuery?: boolean
}

/** `WebSocket.OPEN`, ohne auf DOM- oder Node-Typen angewiesen zu sein. */
const WS_OPEN = 1

function defaultWebSocketFactory(url: string): WebSocketLike {
  // Browser-WebSocket über globalThis, damit keine DOM-Typen nötig sind.
  // Header können hier nicht gesetzt werden (Browser-API-Limitierung).
  const g = globalThis as { WebSocket?: new (url: string) => WebSocketLike }
  if (!g.WebSocket) {
    throw new Error('Keine globale WebSocket-Implementierung gefunden – bitte webSocketFactory übergeben.')
  }
  return new g.WebSocket(url)
}

/** `setTimeout`/`clearTimeout` über globalThis, damit weder DOM- noch Node-Typen nötig sind. */
function schedule(fn: () => void, ms: number): unknown {
  const g = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown }
  return g.setTimeout(fn, ms)
}

function cancelSchedule(handle: unknown): void {
  const g = globalThis as unknown as { clearTimeout(handle: unknown): void }
  g.clearTimeout(handle)
}

/**
 * WebSocket-Transport mit automatischem Reconnect und Scrollback-Resume:
 * Pro Pane wird die letzte gesehene Sequenznummer gemerkt; nach einem
 * Reconnect abonniert der Client alle Panes erneut ab dieser Nummer, so dass
 * kein Output verloren geht und der laufende Prozess erhalten bleibt. Ebenso
 * werden die aktiven Task-Protokoll-Abos erneut geschickt – auch sie hängen
 * serverseitig an der Verbindung.
 *
 * Close-Codes: 4403 (Rechteentzug/Logout) und 4205 (Runtime gestoppt) beenden
 * den Auto-Reconnect; alle anderen Codes – auch 4408 (Backpressure) – führen
 * zu einem Reconnect mit exponentiellem Backoff (500 ms … 5 s).
 */
export class WorkspaceClient {
  clientId: string | null = null
  /** Server-Infos aus dem welcome (ab Protokoll v2; null bei v1-Servern). */
  serverInfo: ServerInfo | null = null
  /** Geltungsbereich der Verbindung aus dem welcome (ab Protokoll v2). */
  scope: ConnectionScope | null = null
  private ws: WebSocketLike | null = null
  private name = ''
  private closedByUser = false
  private retryDelay = 500
  /** Handle des geplanten Reconnects – wird von close() abgebrochen. */
  private reconnectTimer: unknown = null
  private readonly lastSeq = new Map<PaneId, number>()
  private readonly subscriptions = new Set<PaneId>()
  /**
   * Aktive Protokoll-Abos (Task-Läufe). Serverseitig hängen sie wie die
   * Pane-Abos an der Verbindung und sterben mit ihr – also müssen sie nach
   * einem Reconnect genauso erneut geschickt werden.
   */
  private readonly taskLogSubscriptions = new Set<string>()
  private readonly messageListeners = new Set<MessageListener>()
  private readonly statusListeners = new Set<StatusListener>()

  private readonly baseUrl: string
  private readonly factory: WebSocketFactory
  private readonly headers: Record<string, string> | undefined
  private readonly useScopeQuery: boolean

  private target: WorkspaceTarget = { kind: 'project', projectId: '' }

  constructor(options: WorkspaceClientOptions) {
    this.baseUrl = options.url.replace(/\/+$/, '')
    this.factory = options.webSocketFactory ?? defaultWebSocketFactory
    this.headers = options.headers
    this.useScopeQuery = options.useScopeQuery ?? false
  }

  /**
   * Verbindet mit einem Projekt (Projekt-ID als String, kompatibel zur
   * bisherigen Signatur) oder einem {@link WorkspaceTarget} – etwa
   * `{ kind: 'user' }` für die eigene User-Runtime.
   */
  connect(name: string, target: string | WorkspaceTarget): void {
    this.name = name
    this.target = typeof target === 'string' ? { kind: 'project', projectId: target } : target
    this.closedByUser = false
    this.open()
  }

  private query(): string {
    if (this.target.kind === 'user') return 'scope=user'
    return this.useScopeQuery
      ? `scope=${encodeURIComponent(`project:${this.target.projectId}`)}`
      : `project=${encodeURIComponent(this.target.projectId)}`
  }

  private open(): void {
    this.emitStatus(this.clientId ? 'reconnecting' : 'connecting')
    const ws = this.factory(`${this.baseUrl}/ws?${this.query()}`, this.headers)
    this.ws = ws

    ws.onopen = () => {
      this.retryDelay = 500
      this.send({
        type: 'hello',
        protocol: PROTOCOL_VERSION,
        name: this.name,
        ...(this.clientId ? { resumeClientId: this.clientId } : {}),
      })
    }

    ws.onmessage = (ev) => {
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage
      } catch {
        return
      }
      if (msg.type === 'welcome') {
        this.clientId = msg.clientId
        // Ab Protokoll v2; ältere Server senden die Felder nicht.
        this.serverInfo = msg.serverInfo ?? null
        this.scope = msg.scope ?? null
        this.emitStatus('connected')
        // Nach Reconnect: alle Panes ab letzter Sequenznummer wieder abonnieren.
        for (const paneId of this.subscriptions) {
          this.send({ type: 'subscribe', paneId, sinceSeq: this.lastSeq.get(paneId) ?? 0 })
        }
        // Dasselbe für die Protokoll-Abos: Ohne das steht ein geöffnetes
        // Protokollfenster nach jedem Abriss still, ohne jeden Hinweis –
        // besonders heikel, weil gerade ein gesprächiger Protokollstrom die
        // Trennung wegen zu vollem Puffer (4408) selbst auslösen kann.
        // Anders als beim Scrollback gibt es keine Sequenznummer zum Aufsetzen;
        // die Lücke während der Trennung holt der Aufrufer per REST-Schnappschuss.
        for (const runId of this.taskLogSubscriptions) {
          this.send({ type: 'task.log.subscribe', runId })
        }
      } else if (msg.type === 'output' || msg.type === 'scrollback') {
        this.lastSeq.set(msg.paneId, msg.seq)
      }
      for (const l of this.messageListeners) l(msg)
    }

    ws.onclose = (ev) => {
      if (this.closedByUser) {
        this.emitStatus('closed')
        return
      }
      // 4403: Server hat die Verbindung wegen Logout/Rechteentzug beendet –
      // nicht automatisch neu verbinden, die Anwendung entscheidet.
      if (ev.code === 4403) {
        this.emitStatus('kicked')
        return
      }
      // 4205: Runtime wurde gestoppt (Stop/Sleep) – kein Auto-Reconnect,
      // sonst würde die Umgebung sofort wieder geweckt.
      if (ev.code === 4205) {
        this.emitStatus('runtime-stopped')
        return
      }
      this.emitStatus('reconnecting')
      this.reconnectTimer = schedule(() => {
        this.reconnectTimer = null
        this.open()
      }, this.retryDelay)
      this.retryDelay = Math.min(this.retryDelay * 2, 5000)
    }
  }

  close(): void {
    this.closedByUser = true
    // Wartet gerade ein Reconnect-Backoff, würde der Timer sonst nach dem
    // close() eine neue (Zombie-)Verbindung öffnen.
    if (this.reconnectTimer !== null) {
      cancelSchedule(this.reconnectTimer)
      this.reconnectTimer = null
      this.emitStatus('closed')
      return
    }
    this.ws?.close()
  }

  onMessage(l: MessageListener): () => void {
    this.messageListeners.add(l)
    return () => this.messageListeners.delete(l)
  }

  onStatus(l: StatusListener): () => void {
    this.statusListeners.add(l)
    return () => this.statusListeners.delete(l)
  }

  subscribe(paneId: PaneId): void {
    this.subscriptions.add(paneId)
    this.send({ type: 'subscribe', paneId, sinceSeq: this.lastSeq.get(paneId) ?? 0 })
  }

  input(paneId: PaneId, data: string): void {
    this.send({ type: 'input', paneId, data })
  }

  resize(paneId: PaneId, cols: number, rows: number): void {
    this.send({ type: 'resize', paneId, cols, rows })
  }

  requestDriver(paneId: PaneId): void {
    this.send({ type: 'driver.request', paneId })
  }

  releaseDriver(paneId: PaneId): void {
    this.send({ type: 'driver.release', paneId })
  }

  approveDriver(paneId: PaneId, clientId: string): void {
    this.send({ type: 'driver.approve', paneId, clientId })
  }

  denyDriver(paneId: PaneId, clientId: string): void {
    this.send({ type: 'driver.deny', paneId, clientId })
  }

  focus(paneId: PaneId | null): void {
    this.send({ type: 'focus', paneId })
  }

  createPane(): void {
    this.send({ type: 'pane.create' })
  }

  closePane(paneId: PaneId): void {
    this.subscriptions.delete(paneId)
    this.lastSeq.delete(paneId)
    this.send({ type: 'pane.close', paneId })
  }

  /** Live-Protokollzeilen eines Task-Runs abonnieren (auch für Viewer erlaubt). */
  subscribeTaskLog(runId: string): void {
    this.taskLogSubscriptions.add(runId)
    this.send({ type: 'task.log.subscribe', runId })
  }

  /** Abonnement der Protokollzeilen eines Task-Runs wieder aufheben. */
  unsubscribeTaskLog(runId: string): void {
    this.taskLogSubscriptions.delete(runId)
    this.send({ type: 'task.log.unsubscribe', runId })
  }

  private send(msg: ClientMessage): void {
    if (this.ws?.readyState === WS_OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private emitStatus(status: ConnectionStatus): void {
    for (const l of this.statusListeners) l(status)
  }
}
