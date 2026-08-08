// Verwaltungsebene der Remote-Workspaces (Plan 4.4): hält die Serverliste im
// Main-Prozess (gespiegelt aus den Renderer-Settings über server:add/remove,
// beim Start aus state.json geseedet), holt die Projektliste per REST und
// pusht Verbindungs-/Presence-/Driver-Status als Events an den Renderer —
// dasselbe Muster wie der tasks:changed-Push in ipc.ts.

import { AuthManager } from './auth-manager';
import { RemotePtyBackend, type RemoteBackendDeps } from './remote-backend';
import { RemoteFiles } from './remote-files';
import type {
  RemoteAuthStatus, RemoteDriverEvent, RemoteLoginResult, DevicePairingResult,
  RemotePresenceEvent, RemoteProject, RemoteStatusEvent, RemoteUserRuntimeResult,
  RemoteUserRuntimeStopResult, RemoteWorkspaceInfo, ServerConfig
} from '../../shared/types';

export interface RemoteManagerDeps {
  auth: AuthManager;
  /** Push an den Renderer (webContents.send); null-sicher verdrahtet in ipc.ts. */
  send: (channel: 'remote:status' | 'remote:driver' | 'remote:presence', payload: RemoteStatusEvent | RemoteDriverEvent | RemotePresenceEvent) => void;
  /** Beim Start bekannte Server (aus state.json — settings.servers). */
  initialServers: ServerConfig[];
  fetchFn?: typeof fetch;
  /** Durchgereicht an den RemotePtyBackend (Tests). */
  webSocketFactory?: RemoteBackendDeps['webSocketFactory'];
  connectTimeoutMs?: number;
}

export class RemoteManager {
  readonly backend: RemotePtyBackend;
  // REST-Client der Datei-API (B3); nutzt dieselbe Serverliste + Session.
  readonly files: RemoteFiles;
  private readonly servers = new Map<string, ServerConfig>();
  // Presence-Name je Server: der angemeldete Nutzer (gefüllt bei Login/Status).
  private readonly displayNames = new Map<string, string>();

  constructor(private readonly deps: RemoteManagerDeps) {
    for (const server of deps.initialServers) this.servers.set(server.id, server);
    this.files = new RemoteFiles({
      resolve: (serverId) => {
        const server = this.servers.get(serverId);
        if (!server) return null;
        return { baseUrl: server.baseUrl, cookie: this.deps.auth.cookieHeader(serverId) };
      },
      fetchFn: deps.fetchFn
    });
    this.backend = new RemotePtyBackend({
      resolveServer: (serverId) => {
        const server = this.servers.get(serverId);
        if (!server) return null;
        return {
          baseUrl: server.baseUrl,
          cookie: this.deps.auth.cookieHeader(serverId),
          name: this.displayNames.get(serverId) ?? 'Desktop'
        };
      },
      webSocketFactory: deps.webSocketFactory,
      connectTimeoutMs: deps.connectTimeoutMs
    });
    this.backend.onStatus((serverId, scopeKey, status) => {
      this.deps.send('remote:status', { serverId, scopeKey, kind: 'connection', status });
    });
    this.backend.onPanes((serverId, scopeKey, panes, clientId, role) => {
      this.deps.send('remote:status', { serverId, scopeKey, kind: 'panes', panes, clientId, role });
    });
    this.backend.onDriver((serverId, scopeKey, paneId, driver, driverQueue, queueDeadline, clientId, denied) => {
      const event: RemoteDriverEvent = { serverId, scopeKey, paneId, driver, driverQueue, queueDeadline, clientId };
      if (denied) event.denied = true;
      this.deps.send('remote:driver', event);
    });
    this.backend.onPresence((serverId, scopeKey, users) => {
      this.deps.send('remote:presence', {
        serverId, scopeKey,
        users: users.map((u) => ({ clientId: u.clientId, name: u.name, color: u.color, activePane: u.activePane }))
      });
    });
    // Vom Server abgelehnte Aktion (z. B. forbidden) — läuft über denselben
    // remote:status-Kanal wie 'connection'/'panes', damit der Renderer keinen
    // zusätzlichen Kanal abonnieren muss.
    this.backend.onError((serverId, scopeKey, code, paneId) => {
      this.deps.send('remote:status', { serverId, scopeKey, kind: 'error', code, paneId });
    });
  }

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  private server(serverId: string): ServerConfig {
    const server = this.servers.get(serverId);
    if (!server) throw new Error(`unknown remote server: ${serverId}`);
    return server;
  }

  // ---- Serverliste --------------------------------------------------------

  listServers(): ServerConfig[] {
    return [...this.servers.values()];
  }

  addServer(server: ServerConfig): void {
    this.servers.set(server.id, server);
  }

  removeServer(serverId: string): void {
    this.backend.disconnectServer(serverId);
    this.servers.delete(serverId);
    this.displayNames.delete(serverId);
    // Gespeicherte Session mit entfernen — ohne Server-Eintrag käme niemand
    // mehr an den Token heran, er wäre nur noch totes Material auf der Platte.
    this.deps.auth.forget(serverId);
  }

  // ---- Auth (dünne Hülle um AuthManager, ergänzt um Presence-Namen) -------

  async loginLocal(serverId: string, username: string, password: string): Promise<RemoteLoginResult> {
    const server = this.server(serverId);
    const result = await this.deps.auth.loginLocal(server.baseUrl, serverId, username, password);
    if (result.ok && result.user) this.displayNames.set(serverId, result.user.displayName);
    return result;
  }

  async startDevicePairing(serverId: string): Promise<DevicePairingResult> {
    const server = this.server(serverId);
    const result = await this.deps.auth.startDevicePairing(server.baseUrl, serverId);
    if (result.status === 'ok' && result.user) this.displayNames.set(serverId, result.user.displayName);
    return result;
  }

  async logout(serverId: string): Promise<void> {
    const server = this.server(serverId);
    // Erst die WS-Verbindungen kappen — der Server würde sie beim Logout
    // ohnehin mit 4403 schließen, so bleibt kein Reconnect-Versuch übrig.
    this.backend.disconnectServer(serverId);
    this.displayNames.delete(serverId);
    await this.deps.auth.logout(server.baseUrl, serverId);
  }

  async authStatus(serverId: string): Promise<RemoteAuthStatus> {
    const server = this.server(serverId);
    const status = await this.deps.auth.status(server.baseUrl, serverId);
    if (status.loggedIn) this.displayNames.set(serverId, status.user.displayName);
    return status;
  }

  // ---- Projekte & Verbindungen -------------------------------------------

  async projects(serverId: string): Promise<RemoteProject[]> {
    const server = this.server(serverId);
    const cookie = this.deps.auth.cookieHeader(serverId);
    if (!cookie) throw new Error('Nicht angemeldet');
    const res = await this.fetchFn(`${server.baseUrl}/api/projects`, { headers: { Cookie: cookie } });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${res.status}`);
    }
    const projects = Array.isArray(body.projects) ? body.projects : [];
    return projects.flatMap((raw): RemoteProject[] => {
      if (typeof raw !== 'object' || raw === null) return [];
      const p = raw as Record<string, unknown>;
      if (typeof p.id !== 'string' || typeof p.name !== 'string') return [];
      const role = p.role === 'owner' || p.role === 'editor' || p.role === 'viewer' ? p.role : 'viewer';
      return [{ id: p.id, slug: typeof p.slug === 'string' ? p.slug : '', name: p.name, role }];
    });
  }

  connectWorkspace(serverId: string, scopeKey: string): Promise<RemoteWorkspaceInfo> {
    this.server(serverId); // wirft bei unbekanntem Server
    return this.backend.ensureConnection(serverId, scopeKey);
  }

  disconnect(serverId: string, scopeKey: string): void {
    this.backend.disconnect(serverId, scopeKey);
  }

  disconnectAll(): void {
    this.backend.killAll();
  }

  // ---- Persönliche User-Runtime (Phase D) ----------------------------------
  // Fehler kommen wie bei den Auth-Kanälen als ok:false-Ergebnis zurück, damit
  // die UI die Servermeldung 1:1 anzeigen kann (kein Throw über die IPC-Grenze).

  async userRuntime(serverId: string): Promise<RemoteUserRuntimeResult> {
    const res = await this.userRuntimeFetch(serverId, '/api/runtimes/user', 'GET');
    if (!res.ok) return res;
    const body = res.body;
    const status = body.status;
    if (status !== 'running' && status !== 'sleeping' && status !== 'none') {
      return { ok: false, error: 'Unerwartete Serverantwort' };
    }
    const out: RemoteUserRuntimeResult = {
      ok: true,
      status,
      paneCount: typeof body.paneCount === 'number' ? body.paneCount : 0
    };
    const limits = body.limits;
    if (
      typeof limits === 'object' && limits !== null &&
      typeof (limits as Record<string, unknown>).memory === 'string' &&
      typeof (limits as Record<string, unknown>).cpus === 'string'
    ) {
      out.limits = {
        memory: (limits as Record<string, string>).memory,
        cpus: (limits as Record<string, string>).cpus
      };
    }
    return out;
  }

  async userRuntimeStop(serverId: string): Promise<RemoteUserRuntimeStopResult> {
    // Die laufende ?scope=user-Verbindung schließt der Server nach dem Stop
    // selbst mit 4205 — der Client meldet dann runtime-stopped und lässt den
    // Auto-Reconnect (der die Umgebung sofort wieder wecken würde) bleiben.
    const res = await this.userRuntimeFetch(serverId, '/api/runtimes/user/stop', 'POST');
    return res.ok ? { ok: true } : res;
  }

  private async userRuntimeFetch(
    serverId: string, path: string, method: 'GET' | 'POST'
  ): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
    const server = this.server(serverId);
    const cookie = this.deps.auth.cookieHeader(serverId);
    if (!cookie) return { ok: false, error: 'Nicht angemeldet' };
    let res: Response;
    try {
      res = await this.fetchFn(`${server.baseUrl}${path}`, { method, headers: { Cookie: cookie } });
    } catch {
      return { ok: false, error: 'Server nicht erreichbar' };
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: typeof body.error === 'string' ? body.error : `HTTP ${res.status}` };
    }
    return { ok: true, body };
  }
}
