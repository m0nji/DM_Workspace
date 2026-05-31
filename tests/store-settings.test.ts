import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';

describe('settings store actions', () => {
  const saveState = vi.fn();

  beforeEach(() => {
    saveState.mockClear();
    (globalThis as unknown as { window: unknown }).window = {
      api: {
        saveState
      }
    };
    useStore.setState({
      version: 1,
      workspaces: [{ id: 'w1', name: 'One', cwd: '/tmp', layout: null }],
      workspaceTemplates: [],
      activeWorkspaceId: 'w1',
      settings: { themeId: 'default', terminalOpacity: 0.75, workspaceNavigationPlacement: 'left' }
    });
  });

  it('persists workspace navigation placement changes', () => {
    useStore.getState().updateSettings({ workspaceNavigationPlacement: 'top' });

    expect(useStore.getState().settings.workspaceNavigationPlacement).toBe('top');
    expect(saveState).toHaveBeenCalledWith(expect.objectContaining({
      settings: expect.objectContaining({ workspaceNavigationPlacement: 'top' })
    }));
  });
});
