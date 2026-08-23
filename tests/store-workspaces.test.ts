import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';
import { collectPaneIds } from '../src/shared/layout-tree';

describe('workspace store actions', () => {
  const saveState = vi.fn();
  const flushMicrotasks = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: {
        saveState,
        kill: vi.fn()
      }
    };
    // Focus handoff schedules focusTerminal via rAF; run it synchronously here.
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
      (cb: FrameRequestCallback) => { cb(0); return 0; };
    useStore.setState({
      version: 1,
      workspaces: [
        { id: 'w1', name: 'One', cwd: '/tmp', layout: null },
        { id: 'w2', name: 'Two', cwd: '/tmp', layout: null }
      ],
      workspaceGroups: [],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      maximizedPaneId: 'p1',
      paneAutoTitles: {},
      pendingClosePane: null
    });
  });

  it('persists workspace selection', () => {
    useStore.getState().selectWorkspace('w2');

    expect(useStore.getState().activeWorkspaceId).toBe('w2');
    expect(useStore.getState().maximizedPaneId).toBeNull();
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      activeWorkspaceId: 'w2',
      workspaces: expect.any(Array)
    }));
  });

  it('reorders workspaces and persists the new order', () => {
    useStore.setState({
      workspaces: [
        { id: 'w1', name: 'One', cwd: '/tmp', layout: null },
        { id: 'w2', name: 'Two', cwd: '/tmp', layout: null },
        { id: 'w3', name: 'Three', cwd: '/tmp', layout: null }
      ]
    });

    useStore.getState().reorderWorkspace('w3', 'w1', 'before');

    expect(useStore.getState().workspaces.map((w) => w.id)).toEqual(['w3', 'w1', 'w2']);
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      workspaces: [
        expect.objectContaining({ id: 'w3' }),
        expect.objectContaining({ id: 'w1' }),
        expect.objectContaining({ id: 'w2' })
      ]
    }));
  });

  it('does not persist a workspace reorder that leaves the order unchanged', () => {
    useStore.getState().reorderWorkspace('w1', 'w2', 'before');

    expect(useStore.getState().workspaces.map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(saveState).not.toHaveBeenCalled();
  });

  it('ignores selection of an unknown workspace', () => {
    useStore.getState().selectWorkspace('missing');

    expect(useStore.getState().activeWorkspaceId).toBe('w1');
    expect(saveState).not.toHaveBeenCalled();
  });

  it('can resize a split without persisting until commit', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1',
        name: 'One',
        cwd: '/tmp',
        layout: {
          type: 'split',
          id: 's1',
          direction: 'h',
          ratio: 0.5,
          children: [{ type: 'pane', id: 'old1' }, { type: 'pane', id: 'old2' }]
        }
      }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().resizeSplit('s1', 0.7, false);
    expect(saveState).not.toHaveBeenCalled();
    expect(useStore.getState().workspaces[0].layout).toMatchObject({ type: 'split', ratio: 0.7 });

    useStore.getState().resizeSplit('s1', 0.7, true);
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it('focuses the first pane of the selected workspace', () => {
    useStore.setState({
      workspaces: [
        { id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } },
        { id: 'w2', name: 'Two', cwd: '/tmp', layout: { type: 'pane', id: 'old9' } }
      ],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'old1'
    });

    useStore.getState().selectWorkspace('w2');

    expect(useStore.getState().focusedPaneId).toBe('old9');
  });

  it('focuses the new pane after a split', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } }],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'old1'
    });

    useStore.getState().splitActivePane('old1', 'h');

    const ws = useStore.getState().workspaces[0];
    const ids = collectPaneIds(ws.layout);
    expect(ids).toHaveLength(2);
    const newId = ids.find((id) => id !== 'old1');
    expect(useStore.getState().focusedPaneId).toBe(newId);
  });

  it('ignores a split for a pane that is not in the active layout', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().splitActivePane('ghost', 'h');

    expect(collectPaneIds(useStore.getState().workspaces[0].layout)).toEqual(['old1']);
    expect(saveState).not.toHaveBeenCalled();
  });

  it('stores and removes a pane label in its owning workspace', () => {
    useStore.setState({
      workspaces: [
        { id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } },
        { id: 'w2', name: 'Two', cwd: '/tmp', layout: { type: 'pane', id: 'old2' } }
      ],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().setPaneTitle('old2', '  API monitoring  ');

    expect(useStore.getState().workspaces[0].paneTitles).toBeUndefined();
    expect(useStore.getState().workspaces[1].paneTitles).toEqual({ old2: 'API monitoring' });
    expect(saveState).toHaveBeenCalledTimes(1);

    useStore.getState().setPaneTitle('old2', '   ');
    expect(useStore.getState().workspaces[1].paneTitles).toBeUndefined();
  });

  it('uses an ephemeral automatic title unless a manual label overrides it', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().setPaneAutoTitle('old1', 'ssh root@server');
    expect(useStore.getState().paneTitle('old1', '/tmp')).toBe('ssh root@server');
    expect(saveState).not.toHaveBeenCalled();

    useStore.getState().setPaneTitle('old1', 'Production server');
    expect(useStore.getState().paneTitle('old1', '/tmp')).toBe('Production server');

    useStore.getState().setPaneTitle('old1', '');
    expect(useStore.getState().paneTitle('old1', '/tmp')).toBe('ssh root@server');
  });

  it('ignores a pane label for an unknown pane', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } }]
    });

    useStore.getState().setPaneTitle('ghost', 'Unknown');

    expect(useStore.getState().workspaces[0].paneTitles).toBeUndefined();
    expect(saveState).not.toHaveBeenCalled();
  });

  it('hands focus to the closed pane\'s sibling and clears its search state', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1',
        name: 'One',
        cwd: '/tmp',
        layout: {
          type: 'split',
          id: 's1',
          direction: 'h',
          ratio: 0.5,
          children: [{ type: 'pane', id: 'old1' }, { type: 'pane', id: 'old2' }]
        }
      }],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'old1',
      searchOpenPaneId: 'old1'
    });

    useStore.getState().closeActivePane('old1');

    const state = useStore.getState();
    expect(collectPaneIds(state.workspaces[0].layout)).toEqual(['old2']);
    expect(state.focusedPaneId).toBe('old2');
    expect(state.searchOpenPaneId).toBeNull();
  });

  it('stages pane closing for confirmation before changing the layout', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: { type: 'pane', id: 'old1' } }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().requestClosePane('old1');
    expect(useStore.getState().pendingClosePane).toEqual({ paneId: 'old1', remote: false });
    expect(collectPaneIds(useStore.getState().workspaces[0].layout)).toEqual(['old1']);

    useStore.getState().cancelClosePane();
    expect(useStore.getState().pendingClosePane).toBeNull();
    expect(window.api.kill).not.toHaveBeenCalled();
  });

  // A preset replaces the layout wholesale. Panes it displaces are unreachable
  // afterwards, so their PTYs must be killed here or they run on in the main
  // process until quit, with no id left in any layout to address them.
  it('kills the PTYs of panes a preset replaces and drops their metadata', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1',
        name: 'One',
        cwd: '/tmp',
        layout: {
          type: 'split',
          id: 's1',
          direction: 'h',
          ratio: 0.5,
          children: [{ type: 'pane', id: 'old1' }, { type: 'pane', id: 'old2' }]
        }
      }],
      activeWorkspaceId: 'w1',
      paneStatus: { old1: 'busy', old2: 'done' },
      paneCwd: { old1: '/tmp/a', old2: '/tmp/b' },
      paneAutoTitles: { old1: 'build', old2: 'test' }
    });

    useStore.getState().applyPreset('1');

    expect(window.api.kill).toHaveBeenCalledWith('old1');
    expect(window.api.kill).toHaveBeenCalledWith('old2');
    const state = useStore.getState();
    expect(collectPaneIds(state.workspaces[0].layout)).not.toContain('old1');
    expect(collectPaneIds(state.workspaces[0].layout)).not.toContain('old2');
    expect(state.paneStatus).toEqual({});
    expect(state.paneCwd).toEqual({});
    expect(state.paneAutoTitles).toEqual({});
  });

  // The welcome screen is the only live caller, and it has no panes to displace.
  it('applies a preset without killing anything when the workspace is empty', () => {
    useStore.setState({
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: null }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().applyPreset('1');

    expect(window.api.kill).not.toHaveBeenCalled();
    expect(collectPaneIds(useStore.getState().workspaces[0].layout)).toHaveLength(1);
  });

  it('remaps pane titles and pending startup commands when the cwd change restarts panes', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1',
        name: 'One',
        cwd: '/tmp',
        layout: {
          type: 'split',
          id: 's1',
          direction: 'h',
          ratio: 0.5,
          children: [{ type: 'pane', id: 'old1' }, { type: 'pane', id: 'old2' }]
        },
        paneTitles: { old1: 'API', old2: 'Web' },
        pendingStartupCommands: { old1: 'npm run dev' }
      }],
      activeWorkspaceId: 'w1'
    });

    useStore.getState().setWorkspaceCwd('w1', '/elsewhere');

    const ws = useStore.getState().workspaces[0];
    expect(ws.cwd).toBe('/elsewhere');
    const newIds = collectPaneIds(ws.layout);
    expect(newIds).toHaveLength(2);
    expect(newIds).not.toContain('old1');
    expect(newIds).not.toContain('old2');
    // Metadata follows the fresh pane ids — no orphaned old keys survive.
    expect(ws.paneTitles).toEqual({ [newIds[0]]: 'API', [newIds[1]]: 'Web' });
    expect(ws.pendingStartupCommands).toEqual({ [newIds[0]]: 'npm run dev' });
  });

  it('hands focus to the first restarted pane after a cwd change', () => {
    useStore.setState({
      workspaces: [{
        id: 'w1',
        name: 'One',
        cwd: '/tmp',
        layout: {
          type: 'split',
          id: 's1',
          direction: 'h',
          ratio: 0.5,
          children: [{ type: 'pane', id: 'old1' }, { type: 'pane', id: 'old2' }]
        }
      }],
      activeWorkspaceId: 'w1',
      focusedPaneId: 'old1'
    });

    useStore.getState().setWorkspaceCwd('w1', '/elsewhere');

    const newIds = collectPaneIds(useStore.getState().workspaces[0].layout);
    expect(newIds).toHaveLength(2);
    // Keyboard must land in the restarted workspace, not fall into <body>.
    expect(useStore.getState().focusedPaneId).toBe(newIds[0]);
  });

  it('does not start a newer workspace save while an older save is still in flight', async () => {
    const releases: Array<() => void> = [];
    saveState.mockImplementation(() => new Promise<void>((resolve) => {
      releases.push(resolve);
    }));

    useStore.getState().renameWorkspace('w1', 'First');
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveState).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaces: expect.arrayContaining([expect.objectContaining({ id: 'w1', name: 'First' })])
    }));

    useStore.getState().renameWorkspace('w1', 'Second');
    await flushMicrotasks();

    expect(useStore.getState().workspaces[0].name).toBe('Second');
    expect(saveState).toHaveBeenCalledTimes(1);

    releases[0]();
    await flushMicrotasks();

    expect(saveState).toHaveBeenCalledTimes(2);
    expect(saveState).toHaveBeenLastCalledWith(expect.objectContaining({
      workspaces: expect.arrayContaining([expect.objectContaining({ id: 'w1', name: 'Second' })])
    }));

    releases[1]();
    await flushMicrotasks();
  });
});

// Register-Gruppen. Die Entscheidungslogik liegt in shared/workspace-groups und
// ist dort getestet — hier geht es um die Verdrahtung: dass jede Action den
// richtigen Zustand setzt, dass sie speichert, und dass keine Gruppe ohne
// Mitglieder zurueckbleibt.
describe('workspace group actions', () => {
  const saveState = vi.fn();
  const serverRemove = vi.fn().mockResolvedValue(undefined);
  const ws = (id: string, groupId?: string) => ({
    id, name: id.toUpperCase(), cwd: '/tmp', layout: null,
    ...(groupId === undefined ? {} : { groupId })
  });

  beforeEach(() => {
    saveState.mockClear();
    serverRemove.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: {
        saveState,
        serverRemove,
        kill: vi.fn(),
        remoteDisconnect: vi.fn(),
        loadState: vi.fn()
      }
    };
    (globalThis as unknown as { requestAnimationFrame: (cb: FrameRequestCallback) => number }).requestAnimationFrame =
      (cb: FrameRequestCallback) => { cb(0); return 0; };
    useStore.setState({
      version: 1,
      workspaces: [ws('w1'), ws('w2'), ws('w3')],
      workspaceGroups: [],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      maximizedPaneId: null,
      paneAutoTitles: {},
      pendingClosePane: null
    });
  });

  it('groups two loose registers on an into-drop and persists both sides', () => {
    useStore.getState().dropWorkspaceTab('w3', { kind: 'workspace', id: 'w1' }, 'into');

    const s = useStore.getState();
    // Das Gezogene landet direkt hinter dem Ziel, beide tragen dieselbe Gruppe.
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w3', 'w2']);
    expect(s.workspaceGroups).toHaveLength(1);
    const groupId = s.workspaceGroups[0].id;
    expect(s.workspaces.map((w) => w.groupId)).toEqual([groupId, groupId, undefined]);
    expect(s.workspaceGroups[0].name).toBe(''); // unbenannt, der Chip geht ins Umbenennen
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      workspaceGroups: s.workspaceGroups,
      workspaces: s.workspaces
    }));
  });

  // Der Fallstrick aus der Spec: Position unveraendert, nur die Zugehoerigkeit
  // ist neu. Eine No-Op-Erkennung, die nur Ids vergleicht, wirft das weg.
  it('persists a drop that changes only the group membership', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1'), ws('w3')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });
    saveState.mockClear();

    useStore.getState().dropWorkspaceTab('w3', { kind: 'workspace', id: 'w2' }, 'into');

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']); // Reihenfolge identisch
    expect(s.workspaces[2].groupId).toBe('g1'); // aber jetzt in der Gruppe
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it('appends to the end of the group when the chip is the drop target', () => {
    useStore.setState({
      workspaces: [ws('w3'), ws('w1', 'g1'), ws('w2', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().dropWorkspaceTab('w3', { kind: 'group', id: 'g1' }, 'before');

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(s.workspaces.every((w) => w.groupId === 'g1')).toBe(true);
  });

  it('lets a before-drop on the first member leave the group', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1'), ws('w3')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().dropWorkspaceTab('w2', { kind: 'workspace', id: 'w1' }, 'before');

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w2', 'w1', 'w3']);
    expect(s.workspaces[0].groupId).toBeUndefined();
    expect(s.workspaces[1].groupId).toBe('g1');
  });

  // reorderWorkspace laeuft ueber denselben Weg wie dropWorkspaceTab, sonst
  // haenge das Register je nach aufrufender Action in einer Gruppe fest.
  it('releases group membership through reorderWorkspace as well', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().reorderWorkspace('w2', 'w1', 'before');

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w2', 'w1']);
    expect(s.workspaces[0].groupId).toBeUndefined();
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it('renames a group and persists it', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1')],
      workspaceGroups: [{ id: 'g1', name: '' }]
    });

    useStore.getState().renameWorkspaceGroup('g1', 'Backend');

    expect(useStore.getState().workspaceGroups).toEqual([{ id: 'g1', name: 'Backend' }]);
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    }));
  });

  it('does not persist a rename to the same name', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });
    saveState.mockClear();

    useStore.getState().renameWorkspaceGroup('g1', 'Backend');
    useStore.getState().renameWorkspaceGroup('unbekannt', 'Egal');

    expect(saveState).not.toHaveBeenCalled();
  });

  it('collapses and expands a group, dropping the flag when expanded', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().setWorkspaceGroupCollapsed('g1', true);
    expect(useStore.getState().workspaceGroups).toEqual([{ id: 'g1', name: 'Backend', collapsed: true }]);

    useStore.getState().setWorkspaceGroupCollapsed('g1', false);
    // Ausgeklappt heisst "Feld fehlt" — ein Zustand, zwei Schreibweisen waeren einer zu viel.
    expect(useStore.getState().workspaceGroups).toEqual([{ id: 'g1', name: 'Backend' }]);
  });

  it('does not persist a collapse that changes nothing', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });
    saveState.mockClear();

    useStore.getState().setWorkspaceGroupCollapsed('g1', false); // war schon ausgeklappt

    expect(saveState).not.toHaveBeenCalled();
  });

  it('dissolves a group without moving its registers', () => {
    useStore.setState({
      workspaces: [ws('w1'), ws('w2', 'g1'), ws('w3', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().dissolveWorkspaceGroup('g1');

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);
    expect(s.workspaces.every((w) => w.groupId === undefined)).toBe(true);
    expect(s.workspaceGroups).toEqual([]);
    expect(saveState).toHaveBeenCalledTimes(1);
  });

  it('pulls the group back together when a middle member is ungrouped', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2', 'g1'), ws('w3', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().ungroupWorkspace('w2');

    const s = useStore.getState();
    // w2 kann nicht zwischen zwei Mitgliedern liegen bleiben, ohne den Lauf zu
    // zerreissen — es wandert direkt hinter die Gruppe.
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1', 'w3', 'w2']);
    expect(s.workspaces.map((w) => w.groupId)).toEqual(['g1', 'g1', undefined]);
  });

  it('dissolves the group when its last member is ungrouped', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });

    useStore.getState().ungroupWorkspace('w1');

    expect(useStore.getState().workspaceGroups).toEqual([]);
    expect(useStore.getState().workspaces.map((w) => w.groupId)).toEqual([undefined, undefined]);
  });

  it('does not persist ungrouping a register that has no group', () => {
    saveState.mockClear();
    useStore.getState().ungroupWorkspace('w1');
    expect(saveState).not.toHaveBeenCalled();
  });

  it('dissolves the group when its last member is deleted', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1'), ws('w2')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }],
      activeWorkspaceId: 'w2'
    });

    useStore.getState().deleteWorkspace('w1');

    const s = useStore.getState();
    expect(s.workspaces.map((w) => w.id)).toEqual(['w2']);
    expect(s.workspaceGroups).toEqual([]);
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({ workspaceGroups: [] }));
  });

  it('leaves no empty group behind when a server is removed', () => {
    useStore.setState({
      workspaces: [
        ws('w1'),
        {
          id: 'r1', name: 'Remote', cwd: '', layout: null, groupId: 'g1',
          kind: 'remote', remote: { serverId: 'srv1', scope: 'user' }
        }
      ],
      workspaceGroups: [{ id: 'g1', name: 'Server' }],
      activeWorkspaceId: 'w1',
      settings: {
        themeId: 'default', terminalOpacity: 0.75,
        servers: [{ id: 'srv1', name: 'S1', baseUrl: 'https://example.invalid' }]
      }
    });

    useStore.getState().removeServer('srv1');

    const s = useStore.getState();
    // Der Server nimmt seine Remote-Workspaces still mit; die Gruppe darf nicht
    // als Chip ohne Mitglieder zurueckbleiben.
    expect(s.workspaces.map((w) => w.id)).toEqual(['w1']);
    expect(s.workspaceGroups).toEqual([]);
  });

  it('seeds the group id generator from the loaded state', async () => {
    const loadState = vi.fn().mockResolvedValue({
      version: 1,
      workspaces: [ws('w1', 'g7'), ws('w2', 'g7'), ws('w3'), ws('w4')],
      workspaceGroups: [{ id: 'g7', name: 'Sieben' }],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75 }
    });
    (globalThis as unknown as { window: { api: Record<string, unknown> } }).window.api.loadState = loadState;

    await useStore.getState().hydrate();
    expect(useStore.getState().workspaceGroups).toEqual([{ id: 'g7', name: 'Sieben' }]);

    useStore.getState().dropWorkspaceTab('w4', { kind: 'workspace', id: 'w3' }, 'into');

    const ids = useStore.getState().workspaceGroups.map((g) => g.id);
    // Ohne Seeding hiesse die neue Gruppe wieder 'g7' und uebernaehme deren Mitglieder.
    expect(ids).toContain('g7');
    expect(new Set(ids).size).toBe(2);
  });

  // Der Anstoss zum Umbenennen kommt aus der Palette, die Eingabe macht der
  // Chip — deshalb liegt das Ziel im Store und nicht in der Navigation.
  it('merkt sich die Gruppe, die umbenannt werden soll, und gibt sie wieder frei', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });
    saveState.mockClear();

    useStore.getState().setRenamingGroup('g1');
    expect(useStore.getState().renamingGroupId).toBe('g1');

    useStore.getState().setRenamingGroup(null);
    expect(useStore.getState().renamingGroupId).toBeNull();
  });

  it('persistiert das Umbenennen-Ziel nicht', () => {
    useStore.setState({
      workspaces: [ws('w1', 'g1')],
      workspaceGroups: [{ id: 'g1', name: 'Backend' }]
    });
    saveState.mockClear();

    useStore.getState().setRenamingGroup('g1');
    // Fluechtiger Oberflaechenzustand: kein Schreibvorgang, und selbst beim
    // naechsten Speichern taucht das Feld nicht auf (persistSnapshot ist eine
    // Whitelist).
    expect(saveState).not.toHaveBeenCalled();

    useStore.getState().renameWorkspace('w1', 'Neu');
    expect(saveState).toHaveBeenCalledTimes(1);
    expect(saveState.mock.calls[0][0]).not.toHaveProperty('renamingGroupId');
  });

  it('keeps the groups out of the way for a state that has none', () => {
    useStore.getState().renameWorkspace('w1', 'Neu');
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({ workspaceGroups: [] }));
  });
});
