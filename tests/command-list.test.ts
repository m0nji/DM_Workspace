import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCommandList, type CommandItem, type Translate } from '../src/renderer/command-list';
import { useStore, remoteConnKey } from '../src/renderer/store';
import { remotePaneKey } from '../src/shared/remote-pane-key';
import type { RemotePaneInfo, RemoteRole, Workspace } from '../src/shared/types';

// Die Palette ist reines UI, aber ihre Fallunterscheidung lokal/remote ist
// Logik. buildCommandList ist genau deshalb aus der Komponente gelöst: hier
// braucht es kein jsdom, nur den Store.

const SRV = 'srv1';
const PROJ = 'proj1';
const rp = (id: string): string => remotePaneKey(SRV, PROJ, id);
const KEY = `${SRV}:${PROJ}`;

// t liefert den Schlüssel zurück — die Zuordnung Eintrag → Text ist damit im
// Test lesbar, ohne den Katalog mitzuprüfen (das tut i18n-catalog.test.ts).
const t = ((key: string) => key) as unknown as Translate;

function paneInfo(paneId: string): RemotePaneInfo {
  return { paneId, title: paneId, cols: 80, rows: 24, driver: null, driverQueue: [], queueDeadline: null, running: true };
}

function remoteWorkspace(): Workspace {
  return {
    id: 'wr1', name: 'Projekt X', cwd: '~', kind: 'remote',
    remote: { serverId: SRV, scope: 'project', projectId: PROJ },
    layout: {
      type: 'split', id: 's-r1', direction: 'h', ratio: 0.5,
      children: [{ type: 'pane', id: rp('p1') }, { type: 'pane', id: rp('p2') }]
    }
  };
}

const remotePaneCreate = vi.fn();
const remotePaneClose = vi.fn();
const saveState = vi.fn();

function build(): CommandItem[] {
  const s = useStore.getState();
  return buildCommandList({
    actions: s,
    workspaces: s.workspaces,
    templates: s.workspaceTemplates ?? [],
    workspaceGroups: s.workspaceGroups,
    activeWorkspaceId: s.activeWorkspaceId,
    focusedPaneId: s.focusedPaneId,
    shortcutBindings: s.settings.shortcutBindings,
    remote: s.remote,
    paneCwd: s.paneCwd,
    paneAutoTitles: s.paneAutoTitles,
    t,
    isMac: false,
    close: () => undefined
  });
}

function ids(): string[] {
  return build().map((c) => c.id);
}

function connectRemote(role: RemoteRole, panes: RemotePaneInfo[] = [paneInfo('p1'), paneInfo('p2')]): void {
  useStore.setState({
    workspaces: [remoteWorkspace()],
    activeWorkspaceId: 'wr1',
    focusedPaneId: rp('p1'),
    remote: {
      [KEY]: { status: 'connected', clientId: 'c1', role, panes, presence: [], deniedPaneId: null, lastError: null }
    }
  });
}

// Setzt einen konfigurierten Server, einen aktiven Remote-Workspace und eine
// verbundene Verbindung mit den gegebenen serverFeatures — dieselbe
// Voraussetzung, die tasksAvailable() prüft (siehe store.ts).
function connectRemoteWithFeatures(features: string[]): void {
  useStore.setState({
    settings: { themeId: 'default', terminalOpacity: 0.95, servers: [{ id: SRV, name: 'Dev', baseUrl: 'https://x' }] },
    workspaces: [remoteWorkspace()],
    activeWorkspaceId: 'wr1',
    remote: {
      [KEY]: {
        status: 'connected', clientId: 'c1', role: 'editor', panes: [], presence: [],
        deniedPaneId: null, lastError: null, serverFeatures: features
      }
    }
  });
}

describe('buildCommandList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { window: unknown }).window = {
      api: { saveState, kill: vi.fn(), remotePaneCreate, remotePaneClose }
    };
    useStore.setState({
      version: 1,
      workspaces: [{ id: 'w1', name: 'Lokal', cwd: '/tmp', layout: { type: 'pane', id: 'p1' } }],
      workspaceTemplates: [],
      workspaceGroups: [],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.95 },
      remote: {},
      focusedPaneId: 'p1',
      maximizedPaneId: null,
      pendingClosePane: null
    });
  });

  it('bietet im lokalen Workspace beide Split-Befehle und kein Remote-Terminal', () => {
    expect(ids()).toEqual(expect.arrayContaining(['split-h', 'split-v', 'close-pane']));
    expect(ids()).not.toContain('new-remote-terminal-right');
  });

  // Remote gibt es beide Richtungen ebenfalls — nur heissen sie „neues
  // Terminal rechts/darunter" statt „teilen", weil der Server das Terminal
  // anlegt und nur die Einsortierung lokal ist.
  it('bietet im Remote-Workspace beide Richtungen und keinen Split', () => {
    connectRemote('editor');
    expect(ids()).toEqual(expect.arrayContaining(['new-remote-terminal-right', 'new-remote-terminal-below']));
    expect(ids()).not.toContain('split-h');
    expect(ids()).not.toContain('split-v');
  });

  it('legt ueber die Palette in der gewaehlten Richtung an', () => {
    connectRemote('owner');
    build().find((c) => c.id === 'new-remote-terminal-below')!.run();
    expect(remotePaneCreate).toHaveBeenCalledWith(SRV, PROJ);
    expect(useStore.getState().remote[remoteConnKey(SRV, PROJ)].pendingPlacement)
      .toMatchObject({ anchorPaneId: rp('p1'), direction: 'v' });
  });

  it('ohne fokussiertes Pane gibt es weder Split noch Schliessen', () => {
    useStore.setState({ focusedPaneId: null });
    expect(ids()).not.toContain('split-h');
    expect(ids()).not.toContain('close-pane');
  });

  // Der Fund aus dem Abschluss-Review: über die Palette (und damit auch über
  // Mod+W) verschwand ein Terminal für ALLE Verbundenen ohne jede Rückfrage.
  it('schliesst eine Remote-Pane nur über die Rückfrage, nie direkt', () => {
    connectRemote('editor');
    const close = build().find((c) => c.id === 'close-pane');
    expect(close).toBeDefined();
    close!.run();

    expect(remotePaneClose).not.toHaveBeenCalled();
    expect(useStore.getState().pendingClosePane).toEqual({ paneId: rp('p1'), remote: true });
  });

  it('lokales Schliessen bleibt unverändert bei der lokalen Rückfrage', () => {
    build().find((c) => c.id === 'close-pane')!.run();
    expect(useStore.getState().pendingClosePane).toEqual({ paneId: 'p1', remote: false });
  });

  it('nennt bei Rolle viewer den Grund am Remote-Terminal-Eintrag', () => {
    connectRemote('viewer');
    const entry = build().find((c) => c.id === 'new-remote-terminal-right');
    expect(entry?.subtitle).toBe('pane.remoteBlocked.viewer');
    expect(build().find((c) => c.id === 'close-pane')?.subtitle).toBe('pane.remoteBlocked.viewer');
  });

  it('nennt am Pane-Limit den Grund und legt nichts an', () => {
    connectRemote('owner', ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].map(paneInfo));
    const entry = build().find((c) => c.id === 'new-remote-terminal-below');
    expect(entry?.subtitle).toBe('pane.remoteBlocked.paneLimit');
    entry!.run();
    expect(remotePaneCreate).not.toHaveBeenCalled();
  });

  it('nennt ohne Sperre keinen Grund', () => {
    connectRemote('owner');
    expect(build().find((c) => c.id === 'new-remote-terminal-right')?.subtitle).toBeUndefined();
    expect(build().find((c) => c.id === 'close-pane')?.subtitle).toBeUndefined();
  });

  it('ohne konfigurierten Server enthält die Palette keinen einzigen Task-Befehl', () => {
    // Der Alltag der meisten Nutzer: rein lokale App, kein Server.
    expect(ids().filter((id) => id.startsWith('tasks-'))).toEqual([]);
  });

  it('im Remote-Workspace mit tasks-Fähigkeit erscheint der Bereichs-Befehl', () => {
    connectRemoteWithFeatures(['tasks']);
    expect(ids()).toContain('tasks-open');
  });

  it('meldet der Server keine tasks-Fähigkeit, bleibt der Befehl weg', () => {
    connectRemoteWithFeatures([]);
    expect(ids()).not.toContain('tasks-open');
  });

  it('listet alle vier Richtungen mit Kuerzel-Hinweis', () => {
    const list = build();
    expect(list.map((c) => c.id)).toEqual(expect.arrayContaining([
      'focus-pane-left', 'focus-pane-right', 'focus-pane-up', 'focus-pane-down'
    ]));
    const left = list.find((c) => c.id === 'focus-pane-left');
    expect(left?.title).toBe('palette.cmd.focusPaneLeft');
    // build() laeuft mit isMac: false
    expect(left?.hint).toBe('Ctrl+Shift+←');
  });

  it('listet sie nicht ohne fokussiertes Pane', () => {
    useStore.setState({ focusedPaneId: null });
    expect(ids()).not.toContain('focus-pane-left');
  });
});

// Register-Gruppen. Das Gruppieren selbst bleibt eine Drag-Geste — die Palette
// verwaltet nur, was es schon gibt, und laesst einen Beitritt zu einer
// bestehenden Gruppe zu, weil dort das Ziel im Eintrag selbst steht.
describe('buildCommandList: Register-Gruppen', () => {
  const ws = (id: string, groupId?: string) => ({
    id, name: id.toUpperCase(), cwd: `/tmp/${id}`, layout: null,
    ...(groupId === undefined ? {} : { groupId })
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (globalThis as unknown as { window: unknown }).window = {
      api: { saveState, kill: vi.fn(), remotePaneCreate, remotePaneClose }
    };
    useStore.setState({
      version: 1,
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1'), ws('w3')],
      workspaceTemplates: [],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.95 },
      remote: {},
      focusedPaneId: null,
      maximizedPaneId: null,
      pendingClosePane: null
    });
  });

  it('bietet Verwaltung nur an, wenn der aktive Workspace in einer Gruppe ist', () => {
    expect(ids()).toEqual(expect.arrayContaining(['group-collapse', 'group-leave', 'group-dissolve']));

    useStore.setState({ activeWorkspaceId: 'w3' }); // gruppenlos
    const loose = ids();
    expect(loose).not.toContain('group-collapse');
    expect(loose).not.toContain('group-leave');
    expect(loose).not.toContain('group-dissolve');
  });

  it('nennt die Gruppe im Titel und schaltet zwischen Ein- und Ausklappen um', () => {
    const collapse = build().find((c) => c.id === 'group-collapse');
    expect(collapse?.title).toBe('palette.cmd.collapseGroup');

    useStore.setState({ workspaceGroups: [{ id: 'g1', name: 'Backend', collapsed: true }] });
    expect(build().find((c) => c.id === 'group-collapse')?.title).toBe('palette.cmd.expandGroup');
  });

  it('verschweigt nicht, dass Herausloesen das Register verschiebt', () => {
    // Der Hinweis steht in der Unterzeile, wie bei den gesperrten
    // Remote-Aktionen — der Titel bleibt kurz, die Folge trotzdem sichtbar.
    expect(build().find((c) => c.id === 'group-leave')?.subtitle).toBe('palette.cmd.leaveGroupHint');
  });

  it('bietet je fremder Gruppe einen Beitritt an, nie fuer die eigene', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2', 'g2'), ws('w3')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }, { id: 'g2', name: 'Frontend' }]
    });

    expect(ids()).toContain('group-join-g2');
    expect(ids()).not.toContain('group-join-g1'); // w1 ist bereits darin
  });

  it('greift fuer eine namenlose Gruppe auf das Ersatzwort zurueck', () => {
    useStore.setState({ workspaceGroups: [{ id: 'g1', name: '' }] });
    // Der Titel bleibt derselbe Schluessel; entscheidend ist, dass fuer den
    // Namen nicht der Leerstring eingesetzt wird.
    const dissolve = build().find((c) => c.id === 'group-dissolve');
    expect(dissolve?.title).toBe('palette.cmd.dissolveGroup');
  });

  it('klappt die Gruppe des aktiven Workspace tatsaechlich ein', () => {
    build().find((c) => c.id === 'group-collapse')?.run();
    expect(useStore.getState().workspaceGroups).toEqual([{ id: 'g1', name: 'Backend', collapsed: true }]);
  });

  it('loest die Gruppe auf, ohne die Register zu verschieben', () => {
    build().find((c) => c.id === 'group-dissolve')?.run();

    const s = useStore.getState();
    expect(s.workspaceGroups).toEqual([]);
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(s.workspaces.every((w) => w.groupId === undefined)).toBe(true);
  });

  it('loest den aktiven Workspace aus seiner Gruppe heraus', () => {
    useStore.setState({ activeWorkspaceId: 'w2' });
    build().find((c) => c.id === 'group-leave')?.run();

    const s = useStore.getState();
    expect(s.workspaces.find((w) => w.id === 'w2')?.groupId).toBeUndefined();
    expect(s.workspaces.find((w) => w.id === 'w1')?.groupId).toBe('g1');
  });

  it('haengt den aktiven Workspace ans Ende der gewaehlten Gruppe', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1'), ws('w3')],
      activeWorkspaceId: 'w3'
    });

    build().find((c) => c.id === 'group-join-g1')?.run();

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(s.workspaces.every((w) => w.groupId === 'g1')).toBe(true);
  });

  it('nennt die Gruppe in Unterzeile und Suchbegriffen des Wechsel-Eintrags', () => {
    const w2 = build().find((c) => c.id === 'switch-w2');
    expect(w2?.subtitle).toBe('palette.cmd.inGroup · /tmp/w2');
    expect(w2?.keywords).toBe('/tmp/w2 Backend');

    const w3 = build().find((c) => c.id === 'switch-w3'); // gruppenlos
    expect(w3?.subtitle).toBe('/tmp/w3');
    expect(w3?.keywords).toBe('/tmp/w3');
  });

  it('laesst den Mod+N-Hinweis unveraendert', () => {
    const grouped = build().find((c) => c.id === 'switch-w2')?.hint;

    useStore.setState({
      workspaces: [ws('w1'), ws('w2'), ws('w3')],
      workspaceGroups: []
    });
    const loose = build().find((c) => c.id === 'switch-w2')?.hint;

    // Der Hinweis folgt der Array-Position, nicht der Gruppierung.
    expect(grouped).toBe(loose);
    expect(grouped).toBeTruthy();
  });

  it('zeigt ohne Gruppen keinen einzigen Gruppen-Eintrag', () => {
    useStore.setState({
      workspaces: [ws('w1'), ws('w2'), ws('w3')],
      workspaceGroups: []
    });

    const list = ids();
    expect(list.some((id) => id.startsWith('group-'))).toBe(false);
    expect(build().find((c) => c.id === 'switch-w2')?.subtitle).toBe('/tmp/w2');
  });

  // Umbenennen braucht eine Eingabe, die die Palette nicht hat. Der Eintrag
  // setzt deshalb nur das Ziel; die Eingabe macht der Inline-Editor am Chip.
  it('stoesst das Umbenennen an, statt selbst nach dem Namen zu fragen', () => {
    expect(ids()).toContain('group-rename');

    build().find((c) => c.id === 'group-rename')?.run();
    expect(useStore.getState().renamingGroupId).toBe('g1');
    // Der Name selbst bleibt unangetastet — die Palette benennt nicht um.
    expect(useStore.getState().workspaceGroups).toEqual([{ id: 'g1', name: 'Backend' }]);
  });

  it('bietet das Umbenennen nicht an, wenn der aktive Workspace gruppenlos ist', () => {
    useStore.setState({ activeWorkspaceId: 'w3' });
    expect(ids()).not.toContain('group-rename');
  });
});

describe('global pane search', () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.stubGlobal('window', { api: { saveState } });
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { fn(0); return 0; });
    useStore.setState({
      workspaces: [
        { id: 'a', name: 'Frontend', cwd: '/src/web', layout: { type: 'pane', id: 'a1' } },
        { id: 'b', name: 'Services', cwd: '/src/api', groupId: 'g', paneTitles: { b2: 'Logs' }, layout: {
          type: 'split', id: 'split', direction: 'h', ratio: 0.5,
          children: [{ type: 'pane', id: 'b1' }, { type: 'pane', id: 'b2' }]
        } }
      ],
      workspaceGroups: [{ id: 'g', name: 'Backend', collapsed: true }],
      workspaceTemplates: [], remote: {}, activeWorkspaceId: 'a', focusedPaneId: 'a1',
      maximizedPaneId: 'a1', taskView: true,
      paneAutoTitles: { b1: 'Claude', b2: 'npm run dev', stale: 'Ghost' },
      paneCwd: { b2: '/src/api/logs' }
    });
  });

  it('lists all live panes with titles, workspace, group and live directory', () => {
    const panes = build().filter(c => c.id.startsWith('pane-'));
    expect(panes).toHaveLength(3);
    expect(panes.map(c => c.title)).toEqual(['web', 'Claude', 'Logs']);
    expect(panes[2].subtitle).toContain('Services');
    expect(panes[2].subtitle).toContain('Backend');
    expect(panes[2].subtitle).toContain('/src/api/logs');
    expect(panes[2].keywords).toContain('npm run dev');
  });

  it('reveals a pane across workspaces, expands its group and leaves the board', () => {
    const command = build().find(c => c.id === 'pane-b-b2');
    expect(command).toBeDefined();
    command!.run();
    expect(useStore.getState()).toMatchObject({
      activeWorkspaceId: 'b', focusedPaneId: 'b2', maximizedPaneId: null, taskView: false,
      workspaceGroups: [{ id: 'g', collapsed: false }]
    });
  });

  it('ignores a result whose pane has since closed', () => {
    const command = build().find(c => c.id === 'pane-b-b2');
    expect(command).toBeDefined();
    useStore.setState({ workspaces: useStore.getState().workspaces.filter(w => w.id !== 'b') });
    command!.run();
    expect(useStore.getState().activeWorkspaceId).toBe('a');
    expect(useStore.getState().focusedPaneId).toBe('a1');
  });

  it('includes remote panes without requiring an active connection', () => {
    useStore.setState({ workspaces: [remoteWorkspace()], remote: {} });
    expect(build().filter(c => c.id.startsWith('pane-'))).toHaveLength(2);
  });
});
