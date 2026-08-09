import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeServer, waitFor } from './helpers/fake-remote-server';
import { RemoteManager, type RemoteManagerDeps } from '../src/main/remote/remote-manager';
import { AuthManager, type SafeStorageLike } from '../src/main/remote/auth-manager';
import type { RemoteDriverEvent, RemotePresenceEvent, RemoteStatusEvent, RemoteTaskEvent } from '../src/shared/types';

// Deckt genau die Lücke ab, die die Store-Tests nicht sehen können: die
// Verdrahtung backend.onX(...) -> deps.send('remote:status'|'driver'|'presence', ...)
// im RemoteManager-Konstruktor. tests/remote-backend.test.ts prüft nur, dass
// RemotePtyBackend.onError selbst richtig feuert; ob RemoteManager das
// Ergebnis überhaupt weiterreicht, prüft nichts — kein Test instanziiert
// RemoteManager, und `grep -rn "new RemoteManager" tests/ src/` findet nur
// die Produktionsstelle in ipc.ts. Ein kaputter Mapping-Zweig dort würde die
// gesamte Fehler-UI lautlos tot schalten, obwohl jeder andere Test grün
// bleibt. Deshalb hier ein echter RemotePtyBackend gegen denselben
// FakeServer wie remote-backend.test.ts (aus tests/helpers/, kein erneutes
// Ausführen fremder Test-Registrierungen), eingepackt in einen echten
// RemoteManager mit aufzeichnendem `send` — der gesamte Weg vom Server-Frame
// bis zum IPC-Payload läuft einmal wirklich durch, statt nur behauptet zu
// werden.

// Minimale, aber echte AuthManager-Instanz mit einem vorab hinterlegten
// Token: cookieHeader() muss ein truthy Cookie liefern, sonst weigert sich
// RemotePtyBackend.ensureConnection zu verbinden ("not logged in"). Statt
// den echten Login-Flow (Fetch + Set-Cookie-Parsing) nachzustellen, wird der
// Token direkt in der Session-Datei hinterlegt, mit einer Identitäts-
// "Verschlüsselung" (encrypt/decrypt = no-op) als Fake für safeStorage.
function authWithToken(dir: string, serverId: string, token: string): AuthManager {
  const safeStorage: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (s) => Buffer.from(s, 'utf8'),
    decryptString: (b) => b.toString('utf8')
  };
  const file = join(dir, 'remote-auth.json');
  writeFileSync(file, JSON.stringify({ [serverId]: Buffer.from(token, 'utf8').toString('base64') }));
  return new AuthManager({ file, safeStorage, openExternal: () => { /* im Test ungenutzt */ } });
}

// Ein einzelnes Pane auf srv1/p-1 abonnieren — der Standard-Trigger für
// welcome (-> connection- und panes-Push) in den Tests unten. Kein eigenes
// SpawnOptions-Interface importiert, um wie der bestehende onError-Test beim
// strukturell passenden Objektliteral zu bleiben.
function spawnDefaultPane(manager: RemoteManager): void {
  manager.backend.spawn('r:srv1:p-1:rp1', {
    cwd: '~', cols: 80, rows: 24,
    target: { kind: 'remote', serverId: 'srv1', scope: { kind: 'project', projectId: 'p-1' }, remotePaneId: 'rp1' }
  });
}

describe('RemoteManager: backend-Ereignisse -> remote:status/driver/presence-Push', () => {
  let server: FakeServer;
  let dir: string;
  let manager: RemoteManager;
  let sent: Array<{ channel: string; payload: RemoteStatusEvent | RemoteDriverEvent | RemotePresenceEvent | RemoteTaskEvent }>;

  beforeEach(async () => {
    server = new FakeServer();
    await server.start();
    dir = mkdtempSync(join(tmpdir(), 'dmw-remote-manager-'));
    sent = [];
    const deps: RemoteManagerDeps = {
      auth: authWithToken(dir, 'srv1', 'tok123'),
      send: (channel, payload) => sent.push({ channel, payload }),
      initialServers: [{ id: 'srv1', name: 'Dev', baseUrl: `http://127.0.0.1:${server.port}` }],
      connectTimeoutMs: 4000
    };
    manager = new RemoteManager(deps);
  });

  afterEach(async () => {
    manager.backend.killAll();
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('leitet eine vom Server abgelehnte Aktion als remote:status/kind:error weiter', async () => {
    manager.backend.spawn('r:srv1:p-1:rp1', {
      cwd: '~', cols: 80, rows: 24,
      target: { kind: 'remote', serverId: 'srv1', scope: { kind: 'project', projectId: 'p-1' }, remotePaneId: 'rp1' }
    });
    await waitFor(() => server.ofType('subscribe').length >= 1);

    server.error('forbidden', 'role viewer cannot close panes', 'rp1');
    // 'kind' existiert nur auf RemoteStatusEvent — der in-Guard narrowt die
    // Union der drei Payload-Typen, statt sie wegzucasten.
    const isStatusError = (m: (typeof sent)[number]): boolean =>
      m.channel === 'remote:status' && 'kind' in m.payload && m.payload.kind === 'error';
    await waitFor(() => sent.some(isStatusError));

    const errorSends = sent.filter(isStatusError);
    expect(errorSends).toHaveLength(1);
    expect(errorSends[0].payload).toEqual({
      serverId: 'srv1', scopeKey: 'p-1', kind: 'error', code: 'forbidden', paneId: 'rp1'
    });
  });

  it('leitet den Statuswechsel auf "connected" als remote:status/kind:connection weiter', async () => {
    spawnDefaultPane(manager);
    // onStatus feuert vorher auch 'connecting' (derselbe Kanal/kind) — hier
    // zählt nur, dass der Zielzustand nach dem welcome korrekt durchkommt.
    const isConnected = (m: (typeof sent)[number]): boolean =>
      m.channel === 'remote:status' && 'kind' in m.payload && m.payload.kind === 'connection' && m.payload.status === 'connected';
    await waitFor(() => sent.some(isConnected));

    const matches = sent.filter(isConnected);
    expect(matches).toHaveLength(1);
    expect(matches[0].payload).toEqual({ serverId: 'srv1', scopeKey: 'p-1', kind: 'connection', status: 'connected' });
  });

  it('leitet den initialen Pane-Stand aus dem welcome als remote:status/kind:panes weiter', async () => {
    spawnDefaultPane(manager);
    const isPanes = (m: (typeof sent)[number]): boolean =>
      m.channel === 'remote:status' && 'kind' in m.payload && m.payload.kind === 'panes';
    await waitFor(() => sent.some(isPanes));

    const matches = sent.filter(isPanes);
    expect(matches).toHaveLength(1);
    expect(matches[0].payload).toEqual({
      serverId: 'srv1', scopeKey: 'p-1', kind: 'panes',
      panes: [{
        paneId: 'rp1', title: 'Terminal 1', cols: 80, rows: 24,
        driver: null, driverQueue: [], queueDeadline: null, running: true
      }],
      clientId: 'c1', role: 'editor'
    });
    // Panes laufen wie 'connection'/'error' über remote:status — Leck-Check,
    // dass der panes-Push nicht stattdessen auf remote:driver/-presence landet.
    expect(sent.every((m) => m.channel === 'remote:status')).toBe(true);
  });

  // Nachtrag: serverInfo.features aus dem welcome muss bis zum remote:status/
  // kind:panes-Push durchkommen — das ist der einzige Weg, über den der
  // Renderer-Store (RemoteConnectionState.serverFeatures) sie je erreicht.
  it('leitet serverInfo.features aus dem welcome im remote:status/kind:panes-Push weiter', async () => {
    server.features = ['tasks'];
    spawnDefaultPane(manager);
    const isPanes = (m: (typeof sent)[number]): boolean =>
      m.channel === 'remote:status' && 'kind' in m.payload && m.payload.kind === 'panes';
    await waitFor(() => sent.some(isPanes));

    const matches = sent.filter(isPanes);
    expect(matches).toHaveLength(1);
    expect(matches[0].payload).toMatchObject({ kind: 'panes', features: ['tasks'] });
  });

  it('leitet driver.changed als remote:driver weiter, mit eigener clientId zum Selbstvergleich', async () => {
    spawnDefaultPane(manager);
    await waitFor(() => server.ofType('subscribe').length >= 1);

    manager.backend.driverRequest('srv1', 'p-1', 'rp1');
    await waitFor(() => sent.some((m) => m.channel === 'remote:driver'));

    const driverSends = sent.filter((m) => m.channel === 'remote:driver');
    expect(driverSends).toHaveLength(1);
    // 'denied' fehlt bewusst (kein Schlüssel) statt false zu sein — der
    // Manager setzt ihn nur bei denied===true (siehe onDriver-Verdrahtung).
    expect(driverSends[0].payload).toEqual({
      serverId: 'srv1', scopeKey: 'p-1', paneId: 'rp1',
      driver: 'c1', driverQueue: [], queueDeadline: null, clientId: 'c1'
    });
  });

  it('leitet eine Presence-Nachricht als remote:presence weiter, ohne auf anderen Kanälen zu leaken', async () => {
    spawnDefaultPane(manager);
    await waitFor(() => server.ofType('subscribe').length >= 1);

    server.presence([{ clientId: 'c9', name: 'Mira', color: '#3366ff', activePane: 'rp1' }]);
    await waitFor(() => sent.some((m) => m.channel === 'remote:presence'));

    const presenceSends = sent.filter((m) => m.channel === 'remote:presence');
    expect(presenceSends).toHaveLength(1);
    expect(presenceSends[0].payload).toEqual({
      serverId: 'srv1', scopeKey: 'p-1',
      users: [{ clientId: 'c9', name: 'Mira', color: '#3366ff', activePane: 'rp1' }]
    });
    // Leck-Check: die Presence-Nutzliste darf nicht über remote:status oder
    // remote:driver rausgehen (z. B. bei vertauschtem deps.send-Kanal).
    expect(sent.some((m) => m.channel !== 'remote:presence' && JSON.stringify(m.payload).includes('Mira'))).toBe(false);
  });
});
