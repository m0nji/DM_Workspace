import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RemotePtyBackend, DESKTOP_ORIGIN } from '../src/main/remote/remote-backend';
import type { SpawnOptions } from '../src/main/pty-manager';
import { FakeServer, waitFor } from './helpers/fake-remote-server';

function spawnOpts(): SpawnOptions {
  return {
    cwd: '~', cols: 80, rows: 24,
    target: { kind: 'remote', serverId: 'srv1', scope: { kind: 'project', projectId: 'p-1' }, remotePaneId: 'rp1' }
  };
}

describe('RemotePtyBackend (gegen echten ws-Server)', () => {
  let server: FakeServer;
  let backend: RemotePtyBackend;

  beforeEach(async () => {
    server = new FakeServer();
    await server.start();
    backend = new RemotePtyBackend({
      resolveServer: (serverId) =>
        serverId === 'srv1'
          ? { baseUrl: `http://127.0.0.1:${server.port}`, cookie: 'dmw_session=tok', name: 'Karl' }
          : null,
      connectTimeoutMs: 4000
    });
  });

  afterEach(async () => {
    backend.killAll();
    await server.stop();
  });

  it('spawn abonniert die Remote-Pane; Scrollback und Output kommen als onData an', async () => {
    const data: Array<[string, string]> = [];
    backend.onData((paneId, chunk) => data.push([paneId, chunk]));

    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => data.length >= 1);
    expect(data[0]).toEqual(['r:srv1:p-1:rp1', 'HISTORY(since=0)']);
    // Der Upgrade trug Cookie- und Desktop-Origin-Header und die Projekt-Query.
    expect(server.lastUpgradeHeaders.cookie).toBe('dmw_session=tok');
    expect(server.lastUpgradeHeaders.origin).toBe(DESKTOP_ORIGIN);
    expect(server.upgradeUrls[0]).toBe('/ws?project=p-1');

    server.output('rp1', 4, 'live');
    await waitFor(() => data.length >= 2);
    expect(data[1]).toEqual(['r:srv1:p-1:rp1', 'live']);
  });

  it('User-Scope: spawn verbindet über ?scope=user und liefert Output', async () => {
    const data: Array<[string, string]> = [];
    backend.onData((paneId, chunk) => data.push([paneId, chunk]));

    backend.spawn('r:srv1:user:rp1', {
      cwd: '~', cols: 80, rows: 24,
      target: { kind: 'remote', serverId: 'srv1', scope: { kind: 'user' }, remotePaneId: 'rp1' }
    });
    await waitFor(() => data.length >= 1);
    expect(server.upgradeUrls[0]).toBe('/ws?scope=user');
    expect(data[0]).toEqual(['r:srv1:user:rp1', 'HISTORY(since=0)']);
  });

  it('User- und Projekt-Scope desselben Servers nutzen getrennte Verbindungen', async () => {
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    backend.spawn('r:srv1:user:rp1', {
      cwd: '~', cols: 80, rows: 24,
      target: { kind: 'remote', serverId: 'srv1', scope: { kind: 'user' }, remotePaneId: 'rp1' }
    });
    await waitFor(() => server.ofType('subscribe').length >= 2);
    expect(server.sockets).toHaveLength(2);
    expect(server.upgradeUrls.sort()).toEqual(['/ws?project=p-1', '/ws?scope=user']);
    // Beide Scopes sind getrennt adressierbar (eigener Verbindungs-Stand).
    expect(backend.connectionInfo('srv1', 'p-1')).not.toBeNull();
    expect(backend.connectionInfo('srv1', 'user')).not.toBeNull();
  });

  it('ensureConnection mit scopeKey user liefert den welcome-Stand der User-Runtime', async () => {
    const info = await backend.ensureConnection('srv1', 'user');
    expect(info.projectName).toBe('Meine Umgebung');
    expect(info.role).toBe('owner');
    expect(server.upgradeUrls[0]).toBe('/ws?scope=user');
  });

  it('write sendet input; kill sendet unsubscribe (nie pane.close)', async () => {
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.ofType('subscribe').length >= 1);

    backend.write('r:srv1:p-1:rp1', 'ls\r');
    await waitFor(() => server.ofType('input').length >= 1);
    expect(server.ofType('input')[0]).toMatchObject({ paneId: 'rp1', data: 'ls\r' });

    backend.kill('r:srv1:p-1:rp1');
    await waitFor(() => server.ofType('unsubscribe').length >= 1);
    expect(server.ofType('unsubscribe')[0]).toMatchObject({ paneId: 'rp1' });
    expect(server.ofType('pane.close')).toHaveLength(0);
  });

  it('paneCreate sendet pane.create auf der Verbindung der Pane', async () => {
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.received.some((m) => m.type === 'subscribe'));

    backend.paneCreate('srv1', 'p-1');
    await waitFor(() => server.received.some((m) => m.type === 'pane.create'));
    expect(server.received.filter((m) => m.type === 'pane.create')).toHaveLength(1);
  });

  it('paneClose sendet pane.close mit der entfernten Pane-Id', async () => {
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.received.some((m) => m.type === 'subscribe'));

    backend.paneClose('srv1', 'p-1', 'rp2');
    await waitFor(() => server.received.some((m) => m.type === 'pane.close'));
    expect(server.received.find((m) => m.type === 'pane.close')).toMatchObject({ paneId: 'rp2' });
  });

  it('ignoriert Aufrufe für nicht verbundene Scopes', async () => {
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.received.some((m) => m.type === 'subscribe'));

    backend.paneCreate('srv1', 'anderes-projekt');
    backend.paneClose('anderer-server', 'p-1', 'rp2');
    // Nichts darf über die bestehende Verbindung hinausgehen.
    await new Promise((r) => setTimeout(r, 50));
    expect(server.received.some((m) => m.type === 'pane.create')).toBe(false);
    expect(server.received.some((m) => m.type === 'pane.close')).toBe(false);
  });

  it('resize geht nur als Driver raus', async () => {
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.ofType('subscribe').length >= 1);

    // Noch kein Driver -> resize wird lokal verworfen.
    backend.resize('r:srv1:p-1:rp1', 120, 40);
    backend.write('r:srv1:p-1:rp1', 'x'); // Sync-Punkt: input kommt an, resize nicht
    await waitFor(() => server.ofType('input').length >= 1);
    expect(server.ofType('resize')).toHaveLength(0);

    // Driver anfordern; der Testserver bestätigt sofort mit driver.changed.
    const driverEvents: Array<{ driver: string | null; clientId: string | null }> = [];
    backend.onDriver((_s, _p, _pane, driver, _q, _d, clientId) => driverEvents.push({ driver, clientId }));
    backend.driverRequest('srv1', 'p-1', 'rp1');
    await waitFor(() => driverEvents.length >= 1);
    expect(driverEvents[0]).toEqual({ driver: 'c1', clientId: 'c1' });

    backend.resize('r:srv1:p-1:rp1', 120, 40);
    await waitFor(() => server.ofType('resize').length >= 1);
    expect(server.ofType('resize')[0]).toMatchObject({ paneId: 'rp1', cols: 120, rows: 40 });
  });

  it('exit-Message des Servers wird zu onExit', async () => {
    const exits: Array<[string, number]> = [];
    backend.onExit((paneId, code) => exits.push([paneId, code]));
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.ofType('subscribe').length >= 1);

    server.exit('rp1', 42);
    await waitFor(() => exits.length >= 1);
    expect(exits[0]).toEqual(['r:srv1:p-1:rp1', 42]);
  });

  it('error-Message des Servers wird zu onError mit Verbindungsidentität und Pane-Bezug', async () => {
    const errors: Array<{ serverId: string; scopeKey: string; code: string; paneId: string | null }> = [];
    backend.onError((serverId, scopeKey, code, paneId) => errors.push({ serverId, scopeKey, code, paneId }));
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.ofType('subscribe').length >= 1);

    server.error('forbidden', 'role viewer cannot close panes', 'rp1');
    await waitFor(() => errors.length >= 1);
    expect(errors[0]).toEqual({ serverId: 'srv1', scopeKey: 'p-1', code: 'forbidden', paneId: 'rp1' });
  });

  it('error-Message ohne Pane-Bezug (leere oder fehlende paneId) wird zu null normalisiert', async () => {
    const paneIds: Array<string | null> = [];
    backend.onError((_s, _p, _c, paneId) => paneIds.push(paneId));
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => server.ofType('subscribe').length >= 1);

    // Projektweite Ablehnung (z. B. pane.create bei Rolle 'viewer'): der Server
    // schickt paneId als '' statt es ganz wegzulassen.
    server.error('forbidden', 'role viewer cannot create panes', '');
    await waitFor(() => paneIds.length >= 1);
    expect(paneIds[0]).toBeNull();
  });

  it('Reconnect nach Verbindungsabriss: erneutes subscribe mit sinceSeq (Seq-Resume)', async () => {
    const data: string[] = [];
    backend.onData((_paneId, chunk) => data.push(chunk));
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => data.length >= 1); // scrollback mit seq 3 gesehen

    // Abriss ohne Close-Code-Semantik -> Auto-Reconnect des Clients (Backoff 500 ms).
    server.sockets[0].terminate();
    await waitFor(() => server.ofType('subscribe').length >= 2, 8000);
    const resub = server.ofType('subscribe')[1];
    expect(resub).toMatchObject({ paneId: 'rp1', sinceSeq: 3 });
    // resumeClientId hält die Presence-Identität über den Reconnect.
    expect(server.ofType('hello')[1]).toMatchObject({ resumeClientId: 'c1' });
  }, 15000);

  it('Close-Code 4205 (Runtime schläft) stoppt den Auto-Reconnect und meldet runtime-stopped', async () => {
    const statuses: string[] = [];
    backend.onStatus((_s, _p, status) => statuses.push(status));
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => statuses.includes('connected'));

    server.sockets[0].close(4205, 'runtime stopped');
    await waitFor(() => statuses.includes('runtime-stopped'));
    // Kein neuer Verbindungsversuch:
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(server.sockets).toHaveLength(1);
    expect(statuses).not.toContain('reconnecting');
  });

  it('Close-Code 4403 (kicked) meldet kicked ohne Reconnect', async () => {
    const statuses: string[] = [];
    backend.onStatus((_s, _p, status) => statuses.push(status));
    backend.spawn('r:srv1:p-1:rp1', spawnOpts());
    await waitFor(() => statuses.includes('connected'));

    server.sockets[0].close(4403, 'kicked');
    await waitFor(() => statuses.includes('kicked'));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(server.sockets).toHaveLength(1);
  });

  it('ensureConnection liefert den welcome-Stand (Projektname, Rolle, Panes)', async () => {
    const info = await backend.ensureConnection('srv1', 'p-1');
    expect(info.projectName).toBe('Projekt X');
    expect(info.role).toBe('editor');
    expect(info.clientId).toBe('c1');
    expect(info.panes).toHaveLength(1);
    expect(info.panes[0]).toMatchObject({ paneId: 'rp1', title: 'Terminal 1' });
  });

  it('spawn ohne Anmeldung schlägt fehl (kein Cookie -> kein Verbindungsaufbau)', () => {
    const noAuth = new RemotePtyBackend({
      resolveServer: () => ({ baseUrl: 'http://127.0.0.1:1', cookie: null, name: 'x' })
    });
    expect(() => noAuth.spawn('r:s:p:x', {
      cwd: '~', cols: 80, rows: 24,
      target: { kind: 'remote', serverId: 's', scope: { kind: 'project', projectId: 'p' }, remotePaneId: 'x' }
    })).toThrow(/not logged in/);
  });

  it('unbekannter Server schlägt sofort fehl', async () => {
    await expect(backend.ensureConnection('nope', 'p-1')).rejects.toThrow(/unknown remote server/);
  });
});
