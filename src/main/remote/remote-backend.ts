// RemotePtyBackend: TerminalBackend-Implementierung über den Workspace-Server
// (Remote-Workspaces-Plan, 4.4). Eine WorkspaceClient-Instanz (gevendorter
// @dmw/client) pro (Server, Scope) — Scope ist entweder ein Projekt
// (?project=<id>) oder die persönliche User-Runtime (?scope=user, Phase D);
// identifiziert über den scopeKey aus shared/remote-pane-key.ts. Die
// Verbindung läuft über das ws-Paket mit Cookie- und Origin-Header beim
// Upgrade.
//
// Semantik gegenüber dem lokalen PtyManager:
//  - spawn(target.kind==='remote')  = Subscribe auf die Remote-Pane; der Server
//    liefert Scrollback/Resume-Daten, die als onData beim Renderer ankommen.
//  - write  = input-Message (der Server lehnt Nicht-Driver ohnehin ab; der
//    Renderer gated zusätzlich lokal).
//  - resize = nur senden, wenn wir Driver sind — sonst würde jeder Beobachter
//    dem Driver das Terminal umformatieren.
//  - kill   = Unsubscribe, NIEMALS pane.close: das Schließen einer lokalen
//    Ansicht darf die Pane des Projekts nicht zerstören. Das explizite
//    Schließen ist ein eigener Weg (paneClose) mit Rückfrage in der UI.
//  - exit-Message des Servers -> onExit; Close-Codes werden als Statusevents
//    gemeldet (4403 kicked, 4205 Runtime schläft, sonst Auto-Reconnect im
//    Client mit Seq-Resume).

import WebSocket from 'ws';
import { WorkspaceClient, type ConnectionStatus, type WebSocketFactory, type WebSocketLike } from '@dmw/client';
import type { ClientMessage, PaneInfo, PresenceEntry, ServerMessage } from '@dmw/shared';
import type { TerminalBackend, TerminalDataListener, TerminalExitListener } from '../terminal-backend';
import type { SpawnOptions } from '../pty-manager';
import { remoteScopeFromKey, remoteScopeKey } from '../../shared/remote-pane-key';
import type {
  RemotePaneInfo, RemoteRole, RemoteWorkspaceInfo
} from '../../shared/types';

// Verbindungsparameter, die der RemoteManager pro Server auflöst (Base-URL aus
// der Serverliste, Cookie aus dem AuthManager, Anzeigename für Presence).
export interface ResolvedServer {
  /** http(s)-Basis-URL des Servers, z. B. https://dmw.example */
  baseUrl: string;
  /** Cookie-Headerwert (dmw_session=…) oder null, wenn nicht angemeldet. */
  cookie: string | null;
  /** Presence-Name dieses Clients (angemeldeter Nutzer). */
  name: string;
}

export interface RemoteBackendDeps {
  resolveServer: (serverId: string) => ResolvedServer | null;
  webSocketFactory?: WebSocketFactory;
  /** Timeout für das Warten auf das welcome in ensureConnection. */
  connectTimeoutMs?: number;
}

// Der vom Server erlaubte Desktop-Origin (Plan 4.1; serverseitig Teil von
// DMW_ALLOWED_ORIGINS).
export const DESKTOP_ORIGIN = 'dmw-desktop://app';

// Default-Factory über das ws-Paket. Das WebSocketLike-Interface des Clients
// ist strukturell (onopen/onmessage/onclose) — ws erfüllt es direkt; nur der
// error-Handler muss gesetzt sein, weil ein unbehandeltes 'error'-Event eines
// EventEmitters den Prozess reißen würde (onclose folgt danach ohnehin).
function wsFactory(url: string, headers?: Record<string, string>): WebSocketLike {
  const sock = new WebSocket(url, { headers });
  sock.onerror = () => { /* Close-Handling übernimmt onclose */ };
  return sock as unknown as WebSocketLike;
}

// Der gevendorte WorkspaceClient kennt (noch) kein unsubscribe — upstream-Lücke,
// siehe Sync-Skript. Bis dahin gehen unsubscribe-Messages über die private
// send()-Schnittstelle; die Subscription-Buchführung wird mitgepflegt, damit
// ein Reconnect die Pane nicht wieder abonniert.
interface WorkspaceClientInternals {
  send(msg: ClientMessage): void;
  subscriptions: Set<string>;
  lastSeq: Map<string, number>;
}

function sendUnsubscribe(client: WorkspaceClient, paneId: string): void {
  const internals = client as unknown as WorkspaceClientInternals;
  internals.subscriptions.delete(paneId);
  internals.lastSeq.delete(paneId);
  internals.send({ type: 'unsubscribe', paneId });
}

export function toRemotePaneInfo(p: PaneInfo): RemotePaneInfo {
  return {
    paneId: p.paneId,
    title: p.title,
    cols: p.cols,
    rows: p.rows,
    driver: p.driver,
    driverQueue: [...p.driverQueue],
    queueDeadline: p.queueDeadline,
    running: p.running
  };
}

interface Connection {
  serverId: string;
  /** Projekt-UUID oder USER_SCOPE_KEY (shared/remote-pane-key.ts). */
  scopeKey: string;
  client: WorkspaceClient;
  status: ConnectionStatus;
  clientId: string | null;
  /** Anzeigename aus dem welcome (Projektname bzw. „Meine Umgebung"). */
  projectName: string;
  role: 'owner' | 'editor' | 'viewer';
  panes: Map<string, PaneInfo>;
  /** lokale paneId je abonnierter Remote-Pane */
  localByRemote: Map<string, string>;
  welcomeWaiters: Array<{ resolve: (info: RemoteWorkspaceInfo) => void; reject: (err: Error) => void }>;
  disposers: Array<() => void>;
}

export type RemoteStatusListener = (serverId: string, scopeKey: string, status: ConnectionStatus) => void;
export type RemotePanesListener = (serverId: string, scopeKey: string, panes: RemotePaneInfo[], clientId: string | null, role: RemoteRole) => void;
export type RemoteDriverListener = (
  serverId: string, scopeKey: string, paneId: string,
  driver: string | null, driverQueue: string[], queueDeadline: number | null,
  clientId: string | null, denied: boolean
) => void;
export type RemotePresenceListener = (serverId: string, scopeKey: string, users: PresenceEntry[]) => void;
// Vom Server abgelehnte Aktion (z. B. forbidden) — kein Verbindungsabbruch,
// nur eine Rückmeldung, die bis in die UI durchgereicht wird.
export type RemoteErrorListener = (serverId: string, scopeKey: string, code: string, paneId: string | null) => void;

const connKey = (serverId: string, scopeKey: string): string => `${serverId}\u0000${scopeKey}`;

export class RemotePtyBackend implements TerminalBackend {
  private readonly connections = new Map<string, Connection>();
  /** localPaneId -> Verbindungs-/Panezuordnung */
  private readonly paneTargets = new Map<string, { key: string; remotePaneId: string }>();
  private readonly dataListeners: TerminalDataListener[] = [];
  private readonly exitListeners: TerminalExitListener[] = [];
  private readonly statusListeners: RemoteStatusListener[] = [];
  private readonly panesListeners: RemotePanesListener[] = [];
  private readonly driverListeners: RemoteDriverListener[] = [];
  private readonly presenceListeners: RemotePresenceListener[] = [];
  private readonly errorListeners: RemoteErrorListener[] = [];

  constructor(private readonly deps: RemoteBackendDeps) {}

  onData(cb: TerminalDataListener): void { this.dataListeners.push(cb); }
  onExit(cb: TerminalExitListener): void { this.exitListeners.push(cb); }
  onStatus(cb: RemoteStatusListener): void { this.statusListeners.push(cb); }
  onPanes(cb: RemotePanesListener): void { this.panesListeners.push(cb); }
  onDriver(cb: RemoteDriverListener): void { this.driverListeners.push(cb); }
  onPresence(cb: RemotePresenceListener): void { this.presenceListeners.push(cb); }
  onError(cb: RemoteErrorListener): void { this.errorListeners.push(cb); }

  // ---- TerminalBackend ----------------------------------------------------

  spawn(paneId: string, opts: SpawnOptions): void {
    const target = opts.target;
    if (!target || target.kind !== 'remote') {
      throw new Error('RemotePtyBackend: spawn requires a remote target');
    }
    // Projekt- und User-Scope laufen über dieselbe Mechanik: der scopeKey
    // (Projekt-UUID bzw. 'user') wählt die Verbindung aus, die WS-Query
    // (?project=… bzw. ?scope=user) baut der Client aus dem Scope selbst.
    const conn = this.ensureConnectionInternal(target.serverId, remoteScopeKey(target.scope));
    const remotePaneId = target.remotePaneId;
    this.paneTargets.set(paneId, { key: connKey(conn.serverId, conn.scopeKey), remotePaneId });
    conn.localByRemote.set(remotePaneId, paneId);
    // subscribe merkt sich die Pane auch, wenn der Socket noch verbindet — das
    // welcome-Handling des Clients schickt dann subscribe(sinceSeq) nach.
    conn.client.subscribe(remotePaneId);
  }

  write(paneId: string, data: string): void {
    const t = this.paneTargets.get(paneId);
    if (!t) return;
    this.connections.get(t.key)?.client.input(t.remotePaneId, data);
  }

  resize(paneId: string, cols: number, rows: number): void {
    const t = this.paneTargets.get(paneId);
    if (!t) return;
    const conn = this.connections.get(t.key);
    if (!conn) return;
    // Nur der Driver bestimmt die Terminalgröße (Driver-Modell des Servers).
    const pane = conn.panes.get(t.remotePaneId);
    if (!pane || pane.driver === null || pane.driver !== conn.clientId) return;
    // Servergrenzen aus dem Protokoll (isDim: 2..500).
    const clamp = (v: number): number => Math.max(2, Math.min(500, v));
    conn.client.resize(t.remotePaneId, clamp(cols), clamp(rows));
  }

  kill(paneId: string): void {
    const t = this.paneTargets.get(paneId);
    if (!t) return;
    this.paneTargets.delete(paneId);
    const conn = this.connections.get(t.key);
    if (!conn) return;
    conn.localByRemote.delete(t.remotePaneId);
    sendUnsubscribe(conn.client, t.remotePaneId);
  }

  killAll(): void {
    for (const paneId of [...this.paneTargets.keys()]) this.kill(paneId);
    for (const conn of this.connections.values()) this.teardown(conn);
    this.connections.clear();
  }

  killAllAndWait(): Promise<void> {
    // Anders als beim lokalen Backend gibt es keine Prozesse, auf deren Exit zu
    // warten wäre — close() reicht, der Server räumt die Verbindung selbst ab.
    this.killAll();
    return Promise.resolve();
  }

  // ---- Verwaltungs-API (RemoteManager) ------------------------------------

  /**
   * Verbindung zu (Server, Scope) aufbauen (bzw. wiederverwenden) und auf
   * das welcome warten. Wird auch als „Wecken" nach Close-Code 4205 benutzt:
   * bei einer nicht (mehr) verbundenen Verbindung wird neu verbunden.
   */
  ensureConnection(serverId: string, scopeKey: string): Promise<RemoteWorkspaceInfo> {
    let conn: Connection;
    try {
      conn = this.ensureConnectionInternal(serverId, scopeKey);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    if (conn.status === 'connected' && conn.clientId) {
      return Promise.resolve(this.workspaceInfo(conn));
    }
    // kicked/runtime-stopped/closed beenden den Auto-Reconnect des Clients —
    // ein erneutes ensureConnection ist die explizite Nutzerentscheidung, es
    // wieder zu versuchen (Login erneuert / Runtime wecken).
    if (conn.status === 'kicked' || conn.status === 'runtime-stopped' || conn.status === 'closed') {
      this.reconnect(conn);
    }
    const timeoutMs = this.deps.connectTimeoutMs ?? 15_000;
    return new Promise<RemoteWorkspaceInfo>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = conn.welcomeWaiters.findIndex((w) => w.resolve === wrappedResolve);
        if (idx >= 0) conn.welcomeWaiters.splice(idx, 1);
        reject(new Error('Zeitüberschreitung beim Verbinden mit dem Server'));
      }, timeoutMs);
      const wrappedResolve = (info: RemoteWorkspaceInfo): void => { clearTimeout(timer); resolve(info); };
      const wrappedReject = (err: Error): void => { clearTimeout(timer); reject(err); };
      conn.welcomeWaiters.push({ resolve: wrappedResolve, reject: wrappedReject });
    });
  }

  disconnect(serverId: string, scopeKey: string): void {
    const key = connKey(serverId, scopeKey);
    const conn = this.connections.get(key);
    if (!conn) return;
    for (const localPaneId of conn.localByRemote.values()) {
      this.paneTargets.delete(localPaneId);
    }
    this.teardown(conn);
    this.connections.delete(key);
  }

  /** Alle Verbindungen eines Servers kappen (Logout / Server entfernt). */
  disconnectServer(serverId: string): void {
    for (const conn of [...this.connections.values()]) {
      if (conn.serverId === serverId) this.disconnect(conn.serverId, conn.scopeKey);
    }
  }

  connectionInfo(serverId: string, scopeKey: string): { status: ConnectionStatus; clientId: string | null; role: RemoteRole; panes: RemotePaneInfo[] } | null {
    const conn = this.connections.get(connKey(serverId, scopeKey));
    if (!conn) return null;
    return {
      status: conn.status,
      clientId: conn.clientId,
      role: conn.role,
      panes: [...conn.panes.values()].map(toRemotePaneInfo)
    };
  }

  driverRequest(serverId: string, scopeKey: string, paneId: string): void {
    this.connections.get(connKey(serverId, scopeKey))?.client.requestDriver(paneId);
  }

  driverRelease(serverId: string, scopeKey: string, paneId: string): void {
    this.connections.get(connKey(serverId, scopeKey))?.client.releaseDriver(paneId);
  }

  driverApprove(serverId: string, scopeKey: string, paneId: string, clientId: string): void {
    this.connections.get(connKey(serverId, scopeKey))?.client.approveDriver(paneId, clientId);
  }

  driverDeny(serverId: string, scopeKey: string, paneId: string, clientId: string): void {
    this.connections.get(connKey(serverId, scopeKey))?.client.denyDriver(paneId, clientId);
  }

  // Panes gehören dem Projekt: Anlegen und Schließen wirken serverseitig für
  // ALLE Verbundenen. Das lokale Layout wird hier nicht angefasst — der Server
  // antwortet mit pane.added/pane.removed, und erst das zieht das Layout nach.
  paneCreate(serverId: string, scopeKey: string): void {
    this.connections.get(connKey(serverId, scopeKey))?.client.createPane();
  }

  paneClose(serverId: string, scopeKey: string, paneId: string): void {
    this.connections.get(connKey(serverId, scopeKey))?.client.closePane(paneId);
  }

  // ---- intern -------------------------------------------------------------

  private ensureConnectionInternal(serverId: string, scopeKey: string): Connection {
    const key = connKey(serverId, scopeKey);
    const existing = this.connections.get(key);
    if (existing) return existing;

    const resolved = this.deps.resolveServer(serverId);
    if (!resolved) throw new Error(`unknown remote server: ${serverId}`);
    if (!resolved.cookie) throw new Error(`not logged in to remote server: ${serverId}`);

    // http(s)://host -> ws(s)://host; der Client hängt selbst /ws?project=…
    // bzw. /ws?scope=user an (WorkspaceTarget aus dem scopeKey).
    const wsUrl = resolved.baseUrl.replace(/^http/i, 'ws');
    const client = new WorkspaceClient({
      url: wsUrl,
      webSocketFactory: this.deps.webSocketFactory ?? wsFactory,
      // Cookie authentifiziert den Upgrade; der definierte Desktop-Origin ist
      // serverseitig erlaubt (Plan 4.1).
      headers: { Cookie: resolved.cookie, Origin: DESKTOP_ORIGIN }
    });

    const conn: Connection = {
      serverId, scopeKey, client,
      status: 'connecting',
      clientId: null,
      projectName: '',
      role: 'viewer',
      panes: new Map(),
      localByRemote: new Map(),
      welcomeWaiters: [],
      disposers: []
    };
    conn.disposers.push(client.onMessage((msg) => this.handleMessage(conn, msg)));
    conn.disposers.push(client.onStatus((status) => {
      conn.status = status;
      for (const l of this.statusListeners) l(serverId, scopeKey, status);
      if (status === 'kicked' || status === 'runtime-stopped' || status === 'closed') {
        const waiters = conn.welcomeWaiters.splice(0);
        for (const w of waiters) w.reject(new Error(`Verbindung beendet (${status})`));
      }
    }));

    this.connections.set(key, conn);
    // SpawnTargetScope und WorkspaceTarget des Clients sind strukturgleich.
    client.connect(resolved.name, remoteScopeFromKey(scopeKey));
    return conn;
  }

  private reconnect(conn: Connection): void {
    const resolved = this.deps.resolveServer(conn.serverId);
    if (!resolved || !resolved.cookie) return;
    // connect() setzt closedByUser zurück und öffnet den Socket neu; die
    // Subscription-Liste im Client bleibt bestehen -> Seq-Resume für alle Panes.
    conn.status = 'connecting';
    conn.client.connect(resolved.name, remoteScopeFromKey(conn.scopeKey));
  }

  private workspaceInfo(conn: Connection): RemoteWorkspaceInfo {
    return {
      projectName: conn.projectName,
      role: conn.role,
      clientId: conn.clientId ?? '',
      panes: [...conn.panes.values()].map(toRemotePaneInfo)
    };
  }

  private emitPanes(conn: Connection): void {
    const panes = [...conn.panes.values()].map(toRemotePaneInfo);
    for (const l of this.panesListeners) l(conn.serverId, conn.scopeKey, panes, conn.clientId, conn.role);
  }

  private emitDriver(conn: Connection, pane: PaneInfo, denied: boolean): void {
    for (const l of this.driverListeners) {
      l(conn.serverId, conn.scopeKey, pane.paneId, pane.driver, [...pane.driverQueue], pane.queueDeadline, conn.clientId, denied);
    }
  }

  private handleMessage(conn: Connection, msg: ServerMessage): void {
    switch (msg.type) {
      case 'welcome': {
        conn.clientId = msg.clientId;
        conn.projectName = msg.projectName;
        conn.role = msg.role;
        conn.panes = new Map(msg.panes.map((p) => [p.paneId, p]));
        this.emitPanes(conn);
        const waiters = conn.welcomeWaiters.splice(0);
        const info = this.workspaceInfo(conn);
        for (const w of waiters) w.resolve(info);
        break;
      }
      case 'output':
      case 'scrollback': {
        const localPaneId = conn.localByRemote.get(msg.paneId);
        if (localPaneId && msg.data) {
          for (const l of this.dataListeners) l(localPaneId, msg.data);
        }
        break;
      }
      case 'exit': {
        const localPaneId = conn.localByRemote.get(msg.paneId);
        if (localPaneId) {
          for (const l of this.exitListeners) l(localPaneId, msg.exitCode);
        }
        const pane = conn.panes.get(msg.paneId);
        if (pane) pane.running = false;
        break;
      }
      case 'pane.added':
      case 'pane.state': {
        const before = conn.panes.get(msg.pane.paneId);
        conn.panes.set(msg.pane.paneId, msg.pane);
        this.emitPanes(conn);
        // pane.state trägt auch Driver-Wechsel (z. B. Timeout-Übergabe).
        if (!before || before.driver !== msg.pane.driver || before.driverQueue.join() !== msg.pane.driverQueue.join()) {
          this.emitDriver(conn, msg.pane, false);
        }
        break;
      }
      case 'pane.removed': {
        conn.panes.delete(msg.paneId);
        const localPaneId = conn.localByRemote.get(msg.paneId);
        if (localPaneId) {
          // Die Pane existiert im Projekt nicht mehr — für den Renderer ist das
          // ein Exit; die lokale Layout-Bereinigung stößt der Panes-Push an.
          conn.localByRemote.delete(msg.paneId);
          this.paneTargets.delete(localPaneId);
          for (const l of this.exitListeners) l(localPaneId, 0);
        }
        this.emitPanes(conn);
        break;
      }
      case 'driver.changed': {
        const pane = conn.panes.get(msg.paneId);
        if (pane) {
          pane.driver = msg.driver;
          pane.driverQueue = [...msg.driverQueue];
          pane.queueDeadline = msg.queueDeadline;
          this.emitDriver(conn, pane, false);
        }
        break;
      }
      case 'driver.denied': {
        const pane = conn.panes.get(msg.paneId);
        if (pane) this.emitDriver(conn, pane, true);
        break;
      }
      case 'presence': {
        for (const l of this.presenceListeners) l(conn.serverId, conn.scopeKey, msg.users);
        break;
      }
      case 'error':
        // Protokollfehler sind kein Verbindungsabbruch; fürs Debugging loggen …
        console.warn(`[remote] server error (${conn.serverId}/${conn.scopeKey}): ${msg.code} ${msg.message}`);
        // … und der UI melden, damit eine abgelehnte Aktion nicht still versandet
        // (z. B. wenn die Rolle zwischen Preflight-Check und Klick auf 'viewer' wechselt).
        // Der Server schickt bei projektweiten Ablehnungen (z. B. pane.create)
        // paneId als '' statt es wegzulassen — beides heißt "kein Pane-Bezug",
        // der Typ kennt nur null dafür.
        for (const l of this.errorListeners) l(conn.serverId, conn.scopeKey, msg.code, msg.paneId || null);
        break;
    }
  }

  private teardown(conn: Connection): void {
    for (const d of conn.disposers.splice(0)) d();
    const waiters = conn.welcomeWaiters.splice(0);
    for (const w of waiters) w.reject(new Error('Verbindung getrennt'));
    conn.client.close();
  }
}
