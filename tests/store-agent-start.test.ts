import { beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';
import { collectPaneIds } from '../src/shared/layout-tree';

beforeEach(() => {
  vi.stubGlobal('window', { api: { saveState: vi.fn(), input: vi.fn() } });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  useStore.setState({ workspaces: [{ id: 'w', name: 'Project', cwd: '/base', layout: { type: 'pane', id: 'source' } }],
    activeWorkspaceId: 'w', paneCwd: { source: '/actual/project' }, paneShell: { source: 'atPrompt' }, agentStates: {}, pendingAgentStarts: {}, maximizedPaneId: 'source' });
});

it('starts in the existing prompt without changing layout, cwd or maximization', () => {
  expect(useStore.getState().startAgentInPane('source', 'prepared-start')).toBe(true);
  const state = useStore.getState();
  expect(collectPaneIds(state.workspaces[0].layout!)).toEqual(['source']);
  expect(state.paneCwd.source).toBe('/actual/project');
  expect(state.focusedPaneId).toBe('source');
  expect(state.maximizedPaneId).toBe('source');
  expect(state.paneShell.source).toBe('running');
  expect(window.api.input).toHaveBeenCalledWith({ paneId: 'source', data: '\x05\x15prepared-start\r' });
});

it('does not write a start command into a busy, unknown, closed or remote terminal', () => {
  expect(useStore.getState().startAgentInPane('closed', 'start')).toBe(false);
  for (const shell of ['running', 'unknown'] as const) {
    useStore.setState({ paneShell: { source: shell } });
    expect(useStore.getState().startAgentInPane('source', 'start')).toBe(false);
  }
  useStore.setState({ paneShell: { source: 'atPrompt' }, workspaces: [{ ...useStore.getState().workspaces[0], kind: 'remote' }] });
  expect(useStore.getState().startAgentInPane('source', 'start')).toBe(false);
  expect(window.api.input).not.toHaveBeenCalled();
});

it('rejects a second launch and an already connected agent even with a stale prompt marker', () => {
  expect(useStore.getState().startAgentInPane('source', 'first')).toBe(true);
  expect(useStore.getState().startAgentInPane('source', 'second')).toBe(false);
  useStore.setState({ paneShell: { source: 'atPrompt' }, agentStates: { source: {
    provider: 'codex', status: 'working', sessionId: 'active', event: 'UserPromptSubmit', updatedAt: 1
  } } });
  expect(useStore.getState().startAgentInPane('source', 'third')).toBe(false);
  expect(window.api.input).toHaveBeenCalledTimes(1);
});
