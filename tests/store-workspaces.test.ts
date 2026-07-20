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
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      maximizedPaneId: 'p1',
      paneAutoTitles: {},
      pendingClosePaneId: null
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
    expect(useStore.getState().pendingClosePaneId).toBe('old1');
    expect(collectPaneIds(useStore.getState().workspaces[0].layout)).toEqual(['old1']);

    useStore.getState().cancelClosePane();
    expect(useStore.getState().pendingClosePaneId).toBeNull();
    expect(window.api.kill).not.toHaveBeenCalled();
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
