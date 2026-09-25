import { beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '../src/renderer/store';
import { launchIssueKey, startProfileInPane } from '../src/renderer/agent-start';
import { builtinAgentProfile } from '../src/shared/agent-profiles';

const profile = builtinAgentProfile('opencode');
beforeEach(() => {
  vi.stubGlobal('window', { api: {
    saveState: vi.fn(), input: vi.fn(),
    // eslint-disable-next-line @typescript-eslint/require-await -- mirrors the real async IPC signature
    checkAgentStart: vi.fn(async () => 'ready'),
    // eslint-disable-next-line @typescript-eslint/require-await -- mirrors the real async IPC signature
    prepareAgentStatus: vi.fn(async () => ({ command: 'opencode', settingsPath: 's', launchCommand: ". 's.start'" }))
  } });
  vi.stubGlobal('requestAnimationFrame', () => 0);
  useStore.setState({ workspaces: [{ id: 'w', name: 'P', cwd: '/p', layout: { type: 'pane', id: 'a' } }], activeWorkspaceId: 'w',
    paneShell: { a: 'atPrompt' }, agentStates: {}, pendingAgentStarts: {}, agentLaunchIssues: {} });
});

it('checks, prepares and types the start command at a free prompt', async () => {
  expect(await startProfileInPane('a', profile, '/p')).toBe('started');
  expect(window.api.checkAgentStart).toHaveBeenCalledWith('a', profile, '/p');
  expect(window.api.input).toHaveBeenCalledWith({ paneId: 'a', data: "\x05\x15. 's.start'\r" });
});

it('reports check results, busy prompts and cancelled operations without typing', async () => {
  vi.mocked(window.api.checkAgentStart).mockResolvedValueOnce('missing-cli');
  expect(await startProfileInPane('a', profile, '/p')).toBe('missing-cli');
  vi.mocked(window.api.checkAgentStart).mockRejectedValueOnce(new Error('x'));
  expect(await startProfileInPane('a', profile, '/p')).toBe('check-failed');
  expect(await startProfileInPane('a', profile, '/p', () => false)).toBe('cancelled');
  useStore.setState({ paneShell: { a: 'running' } });
  expect(await startProfileInPane('a', profile, '/p')).toBe('prompt-required');
  expect(window.api.input).not.toHaveBeenCalled();
});

it('maps every issue to an existing i18n key', () => {
  expect(launchIssueKey('missing-cli')).toBe('agent.startErrors.missing-cli');
  expect(launchIssueKey('prompt-required')).toBe('agent.promptRequired');
  expect(launchIssueKey('setup-error')).toBe('agent.setupError');
});
