import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    activeWorkspaceId: s.activeWorkspaceId,
    focusedPaneId: s.focusedPaneId,
    shortcutBindings: s.settings.shortcutBindings,
    remote: s.remote,
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
});
