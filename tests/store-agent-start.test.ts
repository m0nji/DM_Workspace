import { beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';
import { collectPaneIds } from '../src/shared/layout-tree';

beforeEach(() => {
  vi.stubGlobal('window', { api: { saveState: vi.fn() } });
  useStore.setState({ workspaces: [{ id: 'w', name: 'Project', cwd: '/base', layout: { type: 'pane', id: 'source' } }],
    activeWorkspaceId: 'w', paneCwd: { source: '/actual/project' }, pendingAgentStarts: {}, maximizedPaneId: 'source' });
});

it('starts in a fresh pane with the source directory and keeps the launch out of saved state', () => {
  const id = useStore.getState().startAgentInNewPane('source', 'codex');
  expect(id).toBeTruthy();
  const state = useStore.getState();
  expect(collectPaneIds(state.workspaces[0].layout!)).toEqual(['source', id]);
  expect(state.pendingAgentStarts[id!]).toEqual({ provider: 'codex', cwd: '/actual/project' });
  expect(state.focusedPaneId).toBe(id);
  expect(state.maximizedPaneId).toBeNull();
  const saved = vi.mocked(window.api.saveState).mock.calls.at(-1)![0];
  expect(saved).not.toHaveProperty('pendingAgentStarts');
  expect(saved.workspaces[0]).not.toHaveProperty('pendingStartupCommands');
  state.finishAgentStart(id!);
  expect(useStore.getState().pendingAgentStarts[id!]).toBeUndefined();
});

it('does not launch after the source is closed or for remote workspaces', () => {
  expect(useStore.getState().startAgentInNewPane('closed', 'claude')).toBeNull();
  useStore.setState({ workspaces: [{ ...useStore.getState().workspaces[0], kind: 'remote' }] });
  expect(useStore.getState().startAgentInNewPane('source', 'claude')).toBeNull();
  expect(useStore.getState().pendingAgentStarts).toEqual({});
});
