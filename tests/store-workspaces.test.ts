import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';

describe('workspace store actions', () => {
  const saveState = vi.fn();

  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: {
        saveState,
        kill: vi.fn()
      }
    };
    useStore.setState({
      version: 1,
      workspaces: [
        { id: 'w1', name: 'One', cwd: '/tmp', layout: null },
        { id: 'w2', name: 'Two', cwd: '/tmp', layout: null }
      ],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75 },
      maximizedPaneId: 'p1'
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
          children: [{ type: 'pane', id: 'p1' }, { type: 'pane', id: 'p2' }]
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
});
