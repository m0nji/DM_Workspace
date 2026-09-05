import { expect, it } from 'vitest';
import { agentOverview } from '../src/renderer/agent-overview';
import type { Workspace } from '../src/shared/types';
import type { AgentState } from '../src/shared/agent-state';

it('prioritizes attention across workspaces and excludes removed panes', () => {
  const workspaces = ['working', 'waiting', 'error', 'done'].map(id => ({ id, name: id, cwd: '/tmp', layout: { type: 'pane', id } })) as Workspace[];
  const state = (status: AgentState['status']): AgentState => ({ provider: 'codex', status, sessionId: 's', event: 'test', updatedAt: 1 });
  const rows = agentOverview(workspaces, { working: state('working'), waiting: state('needs-input'), error: state('error'), done: state('completed'), removed: state('needs-input') });
  expect(rows.map(row => row.paneId)).toEqual(['waiting', 'error', 'working', 'done']);
  expect(rows[0].workspace.name).toBe('waiting');
});
