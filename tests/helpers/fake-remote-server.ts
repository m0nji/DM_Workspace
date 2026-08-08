import { WebSocketServer, type WebSocket as ServerSocket } from 'ws';
import type { AddressInfo } from 'node:net';

// Minimaler Protokoll-v2-Testserver: hello -> welcome, subscribe -> scrollback,
// input/resize/driver.*/unsubscribe werden aufgezeichnet bzw. beantwortet.
// Genau die Teilmenge, die der RemotePtyBackend spricht.
//
// Kein *.test.ts (siehe vitest.config.ts: include nur tests/**/*.test.ts),
// damit tests/remote-backend.test.ts (RemotePtyBackend direkt) und
// tests/remote-manager.test.ts (RemoteManager inkl. der backend.onX(...) ->
// deps.send(...)-Verdrahtung) denselben Testserver importieren können, ohne
// die Test-Registrierung des jeweils anderen Files erneut auszuführen.

export interface ReceivedMessage { type: string; [key: string]: unknown; }

export class FakeServer {
  wss!: WebSocketServer;
  sockets: ServerSocket[] = [];
  received: ReceivedMessage[] = [];
  /** pro Verbindung vergebene clientIds (Reihenfolge des Verbindens) */
  clientCounter = 0;
  driver: string | null = null;
  port = 0;
  lastUpgradeHeaders: Record<string, string | string[] | undefined> = {};
  /** Upgrade-URLs in Verbindungsreihenfolge (?project=… bzw. ?scope=user). */
  upgradeUrls: string[] = [];

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => this.wss.once('listening', resolve));
    this.port = (this.wss.address() as AddressInfo).port;
    this.wss.on('connection', (socket, req) => {
      this.sockets.push(socket);
      this.lastUpgradeHeaders = req.headers;
      this.upgradeUrls.push(req.url ?? '');
      // User-Scope-Verbindungen bekommen ihr eigenes welcome (wie der echte
      // Server: workspaceName „Meine Umgebung", Rolle owner).
      const isUserScope = (req.url ?? '').includes('scope=user');
      socket.on('message', (raw) => {
        const msg = JSON.parse((raw as Buffer).toString('utf8')) as ReceivedMessage;
        this.received.push(msg);
        this.handle(socket, msg, isUserScope);
      });
    });
  }

  private send(socket: ServerSocket, msg: object): void {
    socket.send(JSON.stringify(msg));
  }

  private paneInfo(): object {
    return {
      paneId: 'rp1', title: 'Terminal 1', cols: 80, rows: 24,
      driver: this.driver, driverQueue: [], queueDeadline: null, running: true
    };
  }

  private handle(socket: ServerSocket, msg: ReceivedMessage, isUserScope = false): void {
    switch (msg.type) {
      case 'hello': {
        const clientId = (msg.resumeClientId as string | undefined) ?? `c${++this.clientCounter}`;
        this.send(socket, {
          type: 'welcome', protocol: 2, clientId,
          projectName: isUserScope ? 'Meine Umgebung' : 'Projekt X',
          role: isUserScope ? 'owner' : 'editor',
          panes: [this.paneInfo()],
          serverInfo: { version: 'test', protocolVersion: 2 },
          scope: isUserScope ? { kind: 'user' } : { kind: 'project', projectId: 'p-1' }
        });
        break;
      }
      case 'subscribe': {
        const since = typeof msg.sinceSeq === 'number' ? msg.sinceSeq : -1;
        this.send(socket, {
          type: 'scrollback', paneId: msg.paneId, seq: 3, truncated: false,
          data: `HISTORY(since=${since})`
        });
        break;
      }
      case 'driver.request': {
        this.driver = 'c1';
        this.send(socket, {
          type: 'driver.changed', paneId: msg.paneId, driver: this.driver, driverQueue: [], queueDeadline: null
        });
        break;
      }
      default:
        break; // input/resize/unsubscribe: nur aufzeichnen
    }
  }

  output(paneId: string, seq: number, data: string): void {
    for (const socket of this.sockets) this.send(socket, { type: 'output', paneId, seq, data });
  }

  exit(paneId: string, exitCode: number): void {
    for (const socket of this.sockets) this.send(socket, { type: 'exit', paneId, exitCode });
  }

  // paneId fehlt bei projektweiten Ablehnungen (z. B. pane.create) ganz, oder
  // der Server schickt '' — beide Formen kommen im echten Protokoll vor.
  error(code: string, message: string, paneId?: string): void {
    for (const socket of this.sockets) {
      this.send(socket, paneId === undefined ? { type: 'error', code, message } : { type: 'error', code, message, paneId });
    }
  }

  // Presence-Update (Kanal-Nachbar zu output/exit/error) — bislang von keinem
  // Test gebraucht, tests/remote-manager.test.ts steuert damit die
  // onPresence-Verdrahtung über einen echten Frame statt eines Stubs an.
  presence(users: Array<{ clientId: string; name: string; color: string; activePane: string | null }>): void {
    for (const socket of this.sockets) this.send(socket, { type: 'presence', users });
  }

  ofType(type: string): ReceivedMessage[] {
    return this.received.filter((m) => m.type === type);
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets) socket.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}

export function waitFor(cond: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      if (cond()) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, 10);
    };
    tick();
  });
}
