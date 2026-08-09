import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, isPaneWritable, remoteConnKey, REMOTE_PLACEMENT_TTL_MS } from '../src/renderer/store';
import { collectPaneIds } from '../src/shared/layout-tree';
import { remotePaneKey } from '../src/shared/remote-pane-key';
import type {
  LayoutNode, RemoteConnectionStatus, RemotePaneInfo, RemoteRole, Workspace
} from '../src/shared/types';

const SRV = 'srv1';
const PROJ = 'proj1';
const KEY = remoteConnKey(SRV, PROJ);
const rp = (id: string): string => remotePaneKey(SRV, PROJ, id);

function paneInfo(paneId: string, driver: string | null = null): RemotePaneInfo {
  return { paneId, title: paneId, cols: 80, rows: 24, driver, driverQueue: [], queueDeadline: null, running: true };
}

function remoteWorkspace(paneIds: string[]): Workspace {
  const keys = paneIds.map(rp);
  const layout = keys.length === 1
    ? { type: 'pane' as const, id: keys[0] }
    : {
        type: 'split' as const, id: 's-r1', direction: 'h' as const, ratio: 0.5,
        children: [{ type: 'pane' as const, id: keys[0] }, { type: 'pane' as const, id: keys[1] }] as [
          { type: 'pane'; id: string }, { type: 'pane'; id: string }
        ]
      };
  return { id: 'wr1', name: 'Projekt X', cwd: '~', layout, kind: 'remote', remote: { serverId: SRV, scope: 'project', projectId: PROJ } };
}

describe('remote workspace store actions', () => {
  const saveState = vi.fn();
  const kill = vi.fn();
  const remoteDisconnect = vi.fn();
  const serverAdd = vi.fn().mockResolvedValue(undefined);
  const serverRemove = vi.fn().mockResolvedValue(undefined);
  const remoteConnectWorkspace = vi.fn();
  const remotePaneCreate = vi.fn();
  const remotePaneClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { window: unknown }).window = {
      api: {
        saveState, kill, remoteDisconnect, serverAdd, serverRemove, remoteConnectWorkspace,
        remotePaneCreate, remotePaneClose
      }
    };
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
      (cb: FrameRequestCallback) => { cb(0); return 0; };
    useStore.setState({
      version: 1,
      workspaces: [{ id: 'w1', name: 'Lokal', cwd: '/tmp', layout: null }],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.95 },
      remote: {},
      remoteWorkspaceDialogOpen: false,
      paneStatus: {}, paneCwd: {}, paneAutoTitles: {},
      focusedPaneId: null, maximizedPaneId: null, pendingClosePane: null
    });
  });

  it('addServer legt den Server in den Settings an und meldet ihn im Main-Prozess', () => {
    useStore.getState().addServer('Dev', 'https://dmw.example/');
    const servers = useStore.getState().settings.servers ?? [];
    expect(servers).toHaveLength(1);
    expect(servers[0]).toMatchObject({ name: 'Dev', baseUrl: 'https://dmw.example' });
    expect(serverAdd).toHaveBeenCalledWith(servers[0]);
    expect(saveState).toHaveBeenCalled();
  });

  it('addRemoteWorkspace legt einen Remote-Workspace mit namespaced Panes an', async () => {
    remoteConnectWorkspace.mockResolvedValue({
      projectName: 'Projekt X', role: 'editor', clientId: 'c1',
      panes: [paneInfo('p1'), paneInfo('p2')]
    });
    await useStore.getState().addRemoteWorkspace(SRV, { kind: 'project', projectId: PROJ });

    const s = useStore.getState();
    const ws = s.workspaces.find((w) => w.kind === 'remote');
    expect(ws).toBeDefined();
    expect(ws?.remote).toEqual({ serverId: SRV, scope: 'project', projectId: PROJ });
    expect(ws?.name).toBe('Projekt X');
    expect(collectPaneIds(ws?.layout ?? null).sort()).toEqual([rp('p1'), rp('p2')].sort());
    expect(s.activeWorkspaceId).toBe(ws?.id);
    expect(s.remote[KEY]).toMatchObject({ status: 'connected', clientId: 'c1' });
  });

  it('addRemoteWorkspace mit User-Scope legt einen „Persönliche Umgebung"-Workspace an', async () => {
    remoteConnectWorkspace.mockResolvedValue({
      projectName: 'Meine Umgebung', role: 'owner', clientId: 'c1', panes: [paneInfo('p1')]
    });
    await useStore.getState().addRemoteWorkspace(SRV, { kind: 'user' });

    // Die Verbindung läuft über den scopeKey 'user' (eigener Namensraum, eigene
    // Verbindung neben etwaigen Projekt-Verbindungen desselben Servers).
    expect(remoteConnectWorkspace).toHaveBeenCalledWith(SRV, 'user');
    const s = useStore.getState();
    const ws = s.workspaces.find((w) => w.kind === 'remote');
    expect(ws?.remote).toEqual({ serverId: SRV, scope: 'user' });
    expect(ws?.name).toBe('Meine Umgebung');
    expect(collectPaneIds(ws?.layout ?? null)).toEqual([remotePaneKey(SRV, 'user', 'p1')]);
    expect(s.remote[remoteConnKey(SRV, 'user')]).toMatchObject({ status: 'connected', clientId: 'c1', role: 'owner' });
  });

  // Nachtrag: serverInfo.features aus dem welcome (RemoteWorkspaceInfo.features)
  // muss bis in RemoteConnectionState.serverFeatures ankommen — sonst bleibt
  // die dritte Tasks-Sichtbarkeitsstufe (tasksBlockedReason) dauerhaft bei
  // 'server-too-old', selbst gegen einen Server, der Tasks beherrscht.
  it('addRemoteWorkspace übernimmt serverInfo.features aus dem welcome als serverFeatures', async () => {
    remoteConnectWorkspace.mockResolvedValue({
      projectName: 'Projekt X', role: 'editor', clientId: 'c1',
      panes: [paneInfo('p1')], features: ['tasks']
    });
    await useStore.getState().addRemoteWorkspace(SRV, { kind: 'project', projectId: PROJ });
    expect(useStore.getState().remote[KEY].serverFeatures).toEqual(['tasks']);
  });

  // Ein fehlendes features-Feld (älterer Server ohne serverInfo, oder Server
  // ohne serverInfo.features) darf NICHT als leeres Array ankommen — sonst
  // wäre „Server zu alt" und „Server meldet aktiv keine Fähigkeiten" im Store
  // nicht mehr zu unterscheiden.
  it('addRemoteWorkspace ohne features im welcome lässt serverFeatures undefined', async () => {
    remoteConnectWorkspace.mockResolvedValue({
      projectName: 'Projekt X', role: 'editor', clientId: 'c1', panes: [paneInfo('p1')]
    });
    await useStore.getState().addRemoteWorkspace(SRV, { kind: 'project', projectId: PROJ });
    expect(useStore.getState().remote[KEY].serverFeatures).toBeUndefined();
  });

  it('addRemoteWorkspace aktiviert einen bestehenden Workspace desselben Projekts statt zu doppeln', async () => {
    useStore.setState({ workspaces: [...useStore.getState().workspaces, remoteWorkspace(['p1'])] });
    remoteConnectWorkspace.mockResolvedValue({
      projectName: 'Projekt X', role: 'editor', clientId: 'c1', panes: [paneInfo('p1')]
    });
    await useStore.getState().addRemoteWorkspace(SRV, { kind: 'project', projectId: PROJ });
    const s = useStore.getState();
    expect(s.workspaces.filter((w) => w.kind === 'remote')).toHaveLength(1);
    expect(s.activeWorkspaceId).toBe('wr1');
  });

  it('panes-Push ergänzt neue Server-Panes im Layout und entfernt verschwundene', () => {
    useStore.setState({ workspaces: [remoteWorkspace(['p1', 'p2'])], activeWorkspaceId: 'wr1' });

    // p2 verschwindet, p3 kommt hinzu.
    useStore.getState().applyRemoteStatus({
      serverId: SRV, scopeKey: PROJ, kind: 'panes', clientId: 'c1', role: 'editor',
      panes: [paneInfo('p1'), paneInfo('p3')]
    });

    const ws = useStore.getState().workspaces[0];
    expect(collectPaneIds(ws.layout).sort()).toEqual([rp('p1'), rp('p3')].sort());
    expect(saveState).toHaveBeenCalled();
  });

  it('panes-Push übernimmt mitgesendete serverFeatures und behält den vorigen Wert, wenn sie fehlen', () => {
    useStore.setState({
      workspaces: [remoteWorkspace(['p1'])],
      activeWorkspaceId: 'wr1',
      remote: {
        [KEY]: {
          status: 'connected', clientId: 'c1', role: 'editor' as const, panes: [paneInfo('p1')],
          presence: [], deniedPaneId: null, lastError: null, serverFeatures: ['tasks']
        }
      }
    });

    // Ein Push OHNE features (z. B. weil nur eine Pane hinzukam) darf den
    // zuvor vom welcome gemeldeten Stand nicht auf undefined zurücksetzen.
    useStore.getState().applyRemoteStatus({
      serverId: SRV, scopeKey: PROJ, kind: 'panes', clientId: 'c1', role: 'editor',
      panes: [paneInfo('p1'), paneInfo('p2')]
    });
    expect(useStore.getState().remote[KEY].serverFeatures).toEqual(['tasks']);

    // Ein Push MIT features (z. B. nach einem Reconnect mit neuem welcome)
    // ersetzt den Stand.
    useStore.getState().applyRemoteStatus({
      serverId: SRV, scopeKey: PROJ, kind: 'panes', clientId: 'c1', role: 'editor',
      panes: [paneInfo('p1'), paneInfo('p2')], features: []
    });
    expect(useStore.getState().remote[KEY].serverFeatures).toEqual([]);
  });

  it('connection-Push aktualisiert nur den Status', () => {
    useStore.getState().applyRemoteStatus({ serverId: SRV, scopeKey: PROJ, kind: 'connection', status: 'reconnecting' });
    expect(useStore.getState().remote[KEY].status).toBe('reconnecting');
    expect(saveState).not.toHaveBeenCalled();
  });

  it('driver-Push aktualisiert Driver/Queue und merkt eine abgelehnte Anfrage', () => {
    useStore.setState({
      remote: { [KEY]: { status: 'connected', clientId: 'c1', role: 'editor' as const, panes: [paneInfo('p1')], presence: [], deniedPaneId: null, lastError: null } }
    });
    useStore.getState().applyRemoteDriver({
      serverId: SRV, scopeKey: PROJ, paneId: 'p1',
      driver: 'c2', driverQueue: ['c1'], queueDeadline: 123, clientId: 'c1'
    });
    let conn = useStore.getState().remote[KEY];
    expect(conn.panes[0]).toMatchObject({ driver: 'c2', driverQueue: ['c1'], queueDeadline: 123 });

    useStore.getState().applyRemoteDriver({
      serverId: SRV, scopeKey: PROJ, paneId: 'p1',
      driver: 'c2', driverQueue: [], queueDeadline: null, clientId: 'c1', denied: true
    });
    conn = useStore.getState().remote[KEY];
    expect(conn.deniedPaneId).toBe('p1');
  });

  it('isPaneWritable: lokale Panes immer, Remote-Panes nur als Driver', () => {
    const remote = {
      [KEY]: {
        status: 'connected' as const, clientId: 'c1', role: 'editor' as const,
        panes: [paneInfo('p1', 'c1'), paneInfo('p2', 'c2')],
        presence: [], deniedPaneId: null, lastError: null
      }
    };
    expect(isPaneWritable({ remote }, 'p9')).toBe(true);
    expect(isPaneWritable({ remote }, rp('p1'))).toBe(true);
    expect(isPaneWritable({ remote }, rp('p2'))).toBe(false);
    expect(isPaneWritable({ remote: {} }, rp('p1'))).toBe(false);
  });

  it('deleteWorkspace eines Remote-Workspace trennt die Verbindung statt Prozesse zu killen', () => {
    useStore.setState({
      workspaces: [remoteWorkspace(['p1', 'p2'])],
      activeWorkspaceId: 'wr1',
      remote: { [KEY]: { status: 'connected', clientId: 'c1', role: 'editor' as const, panes: [], presence: [], deniedPaneId: null, lastError: null } }
    });
    useStore.setState({ remoteTasks: { [KEY]: { tasks: [], loading: false, error: null, access: null } } });
    useStore.getState().deleteWorkspace('wr1');

    // kill der Remote-Panes ist die Unsubscribe-Semantik des BackendRouters …
    expect(kill).toHaveBeenCalledWith(rp('p1'));
    expect(kill).toHaveBeenCalledWith(rp('p2'));
    // … und die Verbindung wird explizit getrennt.
    expect(remoteDisconnect).toHaveBeenCalledWith(SRV, PROJ);
    expect(useStore.getState().remote[KEY]).toBeUndefined();
    // Die Task-Liste hängt an derselben Verbindung und geht mit ihr.
    expect(useStore.getState().remoteTasks[KEY]).toBeUndefined();
  });

  it('removeServer entfernt Server, zugehörige Workspaces und die Main-Registrierung', () => {
    useStore.setState({
      settings: { themeId: 'default', terminalOpacity: 0.95, servers: [{ id: SRV, name: 'Dev', baseUrl: 'https://x' }] },
      workspaces: [{ id: 'w1', name: 'Lokal', cwd: '/tmp', layout: null }, remoteWorkspace(['p1'])],
      remote: { [KEY]: { status: 'connected', clientId: 'c1', role: 'editor' as const, panes: [], presence: [], deniedPaneId: null, lastError: null } }
    });
    useStore.setState({ remoteTasks: { [KEY]: { tasks: [], loading: false, error: null, access: null } } });
    useStore.getState().removeServer(SRV);

    const s = useStore.getState();
    expect(s.settings.servers).toBeUndefined();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1']);
    expect(s.remote[KEY]).toBeUndefined();
    expect(s.remoteTasks[KEY]).toBeUndefined();
    expect(kill).toHaveBeenCalledWith(rp('p1'));
    expect(serverRemove).toHaveBeenCalledWith(SRV);
  });

  it('Split und Schließen sind für Remote-Workspaces gesperrt', () => {
    useStore.setState({ workspaces: [remoteWorkspace(['p1', 'p2'])], activeWorkspaceId: 'wr1' });
    const before = useStore.getState().workspaces[0].layout;

    useStore.getState().splitActivePane(rp('p1'), 'h');
    expect(useStore.getState().workspaces[0].layout).toBe(before);

    // Ohne Verbindung ist auch der Remote-Weg zu: keine Rueckfrage, kein Versand.
    useStore.getState().requestClosePane(rp('p1'));
    expect(useStore.getState().pendingClosePane).toBeNull();

    useStore.getState().closeActivePane(rp('p1'));
    expect(useStore.getState().workspaces[0].layout).toBe(before);
    expect(kill).not.toHaveBeenCalled();
  });

  describe('Remote-Panes aus dem Desktop steuern', () => {
    // Zwei Panes als Normalfall: mit nur einem Pane lehnt der Server das
    // Schliessen ab (hub.closePane), was der Store inzwischen selbst kennt.
    const connected = (
      role: RemoteRole,
      status: RemoteConnectionStatus = 'connected',
      panes: RemotePaneInfo[] = [paneInfo('p1'), paneInfo('p2')]
    ): void => {
      useStore.setState({
        workspaces: [remoteWorkspace(['p1', 'p2'])],
        activeWorkspaceId: 'wr1',
        remote: {
          [KEY]: { status, clientId: 'c1', role, panes, presence: [], deniedPaneId: null, lastError: null }
        }
      });
    };
    const lastError = (): { code: string; paneId: string | null } | undefined => {
      const e = useStore.getState().remote[KEY]?.lastError;
      return e ? { code: e.code, paneId: e.paneId } : undefined;
    };
    // Derselbe Rueckruf, den App.tsx ueber onRemoteStatus registriert
    // (window.api.onRemoteStatus(s.applyRemoteStatus)) — hier direkt aufgerufen,
    // wie es die vorhandenen kind: 'panes'-Tests bereits tun.
    const statusHandler = useStore.getState().applyRemoteStatus;

    it('sendet pane.create fuer die Verbindung der Pane', () => {
      connected('owner');
      useStore.getState().createRemotePane(rp('p1'));
      expect(remotePaneCreate).toHaveBeenCalledWith(SRV, PROJ);
    });

    it('sendet pane.close mit der entfernten Pane-Id', () => {
      connected('editor');
      useStore.getState().closeRemotePane(rp('p1'));
      expect(remotePaneClose).toHaveBeenCalledWith(SRV, PROJ, 'p1');
    });

    it('sendet nichts als viewer und meldet den Grund', () => {
      connected('viewer');
      useStore.getState().createRemotePane(rp('p1'));
      expect(remotePaneCreate).not.toHaveBeenCalled();
      expect(lastError()).toEqual({ code: 'viewer', paneId: 'p1' });

      useStore.getState().closeRemotePane(rp('p1'));
      expect(remotePaneClose).not.toHaveBeenCalled();
      expect(lastError()).toEqual({ code: 'viewer', paneId: 'p1' });
    });

    it('sendet nichts bei geschlossener Verbindung und meldet den Grund', () => {
      connected('owner', 'closed');
      useStore.getState().createRemotePane(rp('p1'));
      expect(remotePaneCreate).not.toHaveBeenCalled();
      expect(lastError()).toEqual({ code: 'offline', paneId: 'p1' });
    });

    // Der Server deckelt bei MAX_PANES = 6, verwirft das Ergebnis von createPane
    // aber ohne Fehlermeldung — ohne diese Pruefung waere '+' dort wirkungslos.
    it('legt am Pane-Limit nichts an und meldet den Grund', () => {
      const panes = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map((id) => paneInfo(id));
      connected('owner', 'connected', panes);
      useStore.getState().createRemotePane(rp('p1'));
      expect(remotePaneCreate).not.toHaveBeenCalled();
      expect(lastError()).toEqual({ code: 'paneLimit', paneId: 'p1' });
    });

    // Gegenstueck: hub.closePane laesst das letzte Pane stehen und antwortet
    // ebenfalls nicht. Die Rueckfrage darf dafuer gar nicht erst aufgehen.
    it('schliesst das letzte Terminal nicht und meldet den Grund', () => {
      connected('owner', 'connected', [paneInfo('p1')]);
      useStore.getState().requestClosePane(rp('p1'));
      expect(useStore.getState().pendingClosePane).toBeNull();
      expect(remotePaneClose).not.toHaveBeenCalled();
      expect(lastError()).toEqual({ code: 'lastPane', paneId: 'p1' });
    });

    it('raeumt eine alte Meldung ab, sobald eine Aktion durchgeht', () => {
      connected('editor');
      useStore.setState({
        remote: {
          [KEY]: {
            ...useStore.getState().remote[KEY],
            lastError: { code: 'rate_limited', paneId: null, at: Date.now() }
          }
        }
      });
      useStore.getState().createRemotePane(rp('p1'));
      expect(remotePaneCreate).toHaveBeenCalled();
      expect(useStore.getState().remote[KEY].lastError).toBeNull();
    });

    it('ignoriert lokale Pane-Ids', () => {
      connected('owner');
      useStore.getState().createRemotePane('p3');
      expect(remotePaneCreate).not.toHaveBeenCalled();
    });

    // Kern des Fix-Reviews: Schliessen fragt auf JEDEM Weg zurueck. Palette und
    // Tastenkuerzel rufen dieselbe Aktion wie der Knopf im Pane-Kopf.
    it('fragt vor dem Schliessen einer Remote-Pane zurueck, statt sofort zu senden', () => {
      connected('editor');
      useStore.getState().requestClosePane(rp('p1'));
      expect(useStore.getState().pendingClosePane).toEqual({ paneId: rp('p1'), remote: true });
      expect(remotePaneClose).not.toHaveBeenCalled();

      useStore.getState().confirmClosePane();
      expect(remotePaneClose).toHaveBeenCalledWith(SRV, PROJ, 'p1');
      expect(useStore.getState().pendingClosePane).toBeNull();
    });

    it('bricht die Rueckfrage folgenlos ab', () => {
      connected('editor');
      useStore.getState().requestClosePane(rp('p1'));
      useStore.getState().cancelClosePane();
      expect(useStore.getState().pendingClosePane).toBeNull();
      expect(remotePaneClose).not.toHaveBeenCalled();
    });

    // Faellt die Verbindung zwischen Frage und Bestaetigung aus, darf das
    // Bestaetigen nicht still verpuffen.
    it('meldet den Grund, wenn die Verbindung vor dem Bestaetigen wegbricht', () => {
      connected('editor');
      useStore.getState().requestClosePane(rp('p1'));
      statusHandler({ serverId: SRV, scopeKey: PROJ, kind: 'connection', status: 'closed' });
      useStore.getState().confirmClosePane();
      expect(remotePaneClose).not.toHaveBeenCalled();
      expect(lastError()).toEqual({ code: 'offline', paneId: 'p1' });
    });

    it('merkt sich eine abgelehnte Pane-Aktion an der Verbindung', () => {
      connected('viewer');
      statusHandler({ serverId: SRV, scopeKey: PROJ, kind: 'error', code: 'forbidden', paneId: null });
      expect(lastError()).toEqual({ code: 'forbidden', paneId: null });
      // Zeitstempel: die Anzeige blendet die Meldung danach selbst wieder aus.
      expect(useStore.getState().remote[KEY].lastError?.at).toBeGreaterThan(0);
    });

    it('raeumt den Fehler beim naechsten Panes-Ereignis wieder ab', () => {
      connected('editor');
      statusHandler({ serverId: SRV, scopeKey: PROJ, kind: 'error', code: 'forbidden', paneId: null });
      statusHandler({
        serverId: SRV, scopeKey: PROJ, kind: 'panes',
        clientId: 'c1', role: 'editor', panes: [paneInfo('p1')]
      });
      expect(useStore.getState().remote[KEY].lastError).toBeNull();
    });

    // Regression: bisher raeumte nur der panes-Zweig lastError ab. Ohne diesen
    // Zweig blieb "nur lesend" nach einem Reconnect mit neuer Rolle stehen,
    // obwohl seither nichts mehr abgelehnt wurde (Fund im Fix-Review).
    it('raeumt den Fehler auch bei einem Connection-Ereignis ab', () => {
      connected('viewer');
      statusHandler({ serverId: SRV, scopeKey: PROJ, kind: 'error', code: 'forbidden', paneId: null });
      statusHandler({ serverId: SRV, scopeKey: PROJ, kind: 'connection', status: 'connected' });
      expect(useStore.getState().remote[KEY].lastError).toBeNull();
    });

    // Ohne diesen Weg bliebe eine einzelne Ablehnung auf einer stabilen
    // Verbindung dauerhaft stehen — es kommt dann kein Ereignis mehr, das sie
    // abraeumen wuerde. Den Wecker stellt RemotePaneBar (REMOTE_ERROR_TTL_MS).
    it('laesst sich ohne weiteres Ereignis abraeumen', () => {
      connected('viewer');
      statusHandler({ serverId: SRV, scopeKey: PROJ, kind: 'error', code: 'rate_limited', paneId: null });
      useStore.getState().clearRemoteError(SRV, PROJ);
      expect(useStore.getState().remote[KEY].lastError).toBeNull();
    });

    // Der Server kennt keine Anordnung — die Wahl „rechts daneben" bzw.
    // „darunter" ist deshalb ein Wunsch, den der Klick hinterlegt und der
    // naechste panes-Push einloest.
    describe('Richtung der neuen Remote-Pane', () => {
      // Der Teilbaum, in dem die neue Pane sitzt: [Richtung, Geschwister].
      const placementOf = (newPane: string): [string, string[]] | null => {
        const walk = (node: LayoutNode | null): [string, string[]] | null => {
          if (!node || node.type === 'pane') return null;
          const ids = node.children.map((c) => collectPaneIds(c));
          if (ids.some((group) => group.length === 1 && group[0] === newPane)) {
            return [node.direction, ids.flat()];
          }
          return walk(node.children[0]) ?? walk(node.children[1]);
        };
        return walk(useStore.getState().workspaces[0].layout);
      };
      const pushPanes = (ids: string[]): void => statusHandler({
        serverId: SRV, scopeKey: PROJ, kind: 'panes',
        clientId: 'c1', role: 'editor', panes: ids.map((id) => paneInfo(id))
      });

      it('setzt die neue Pane rechts neben die angeklickte', () => {
        connected('owner');
        useStore.getState().createRemotePane(rp('p1'), 'h');
        pushPanes(['p1', 'p2', 'p3']);
        expect(placementOf(rp('p3'))).toEqual(['h', [rp('p1'), rp('p3')]]);
      });

      it('setzt die neue Pane unter die angeklickte und fokussiert sie', () => {
        connected('owner');
        useStore.getState().createRemotePane(rp('p1'), 'v');
        pushPanes(['p1', 'p2', 'p3']);
        expect(placementOf(rp('p3'))).toEqual(['v', [rp('p1'), rp('p3')]]);
        expect(useStore.getState().focusedPaneId).toBe(rp('p3'));
        // Eingeloest heisst verbraucht: die naechste Pane haengt wieder hinten an.
        expect(useStore.getState().remote[KEY].pendingPlacement).toBeNull();
      });

      // Tastenkuerzel und Palette laufen ueber splitActivePane — auch im
      // Remote-Workspace, sonst waere „oben/unten teilen" dort wirkungslos.
      it('nimmt die Richtung auch ueber splitActivePane entgegen', () => {
        connected('owner');
        useStore.getState().splitActivePane(rp('p2'), 'v');
        expect(remotePaneCreate).toHaveBeenCalledWith(SRV, PROJ);
        pushPanes(['p1', 'p2', 'p3']);
        expect(placementOf(rp('p3'))).toEqual(['v', [rp('p2'), rp('p3')]]);
      });

      // Eine fremde Pane (Browser, anderer Client) hat keinen Wunsch hinterlegt
      // und haengt weiterhin rechts an — und sie zieht den Fokus nicht weg.
      it('haengt eine fremde Pane ohne Wunsch rechts an', () => {
        connected('owner');
        useStore.setState({ focusedPaneId: rp('p1') });
        pushPanes(['p1', 'p2', 'p3']);
        expect(placementOf(rp('p3'))).toEqual(['h', [rp('p2'), rp('p3')]]);
        expect(useStore.getState().focusedPaneId).toBe(rp('p1'));
      });

      // Bleibt der eigene pane.added aus (verworfen, Verbindungswechsel), darf
      // der alte Wunsch nicht die naechste fremde Pane an sich reissen.
      it('verfaellt nach Ablauf der Frist', () => {
        connected('owner');
        useStore.getState().createRemotePane(rp('p1'), 'v');
        const conn = useStore.getState().remote[KEY];
        useStore.setState({
          remote: {
            [KEY]: {
              ...conn,
              pendingPlacement: { ...conn.pendingPlacement!, at: Date.now() - REMOTE_PLACEMENT_TTL_MS - 1 }
            }
          }
        });
        pushPanes(['p1', 'p2', 'p3']);
        expect(placementOf(rp('p3'))).toEqual(['h', [rp('p2'), rp('p3')]]);
      });
    });
  });
});
