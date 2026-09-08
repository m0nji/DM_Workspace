import { agentPhase, agentNeedsAttention } from '../shared/agent-presentation';
import { collectPaneIds } from '../shared/layout-tree';
import type { Workspace } from '../shared/types';
import type { AgentState } from '../shared/agent-state';

const priority: Record<AgentState['status'], number> = { 'needs-input': 0, error: 1, working: 2, completed: 3, unknown: 4 };
export function agentOverview(workspaces: Workspace[], states: Record<string, AgentState>): Array<{ workspace: Workspace; paneId: string; position: number; state: AgentState }> {
  return workspaces.flatMap(workspace => collectPaneIds(workspace.layout).flatMap((paneId, index) =>
    states[paneId] && !['paused', 'ended', 'ending'].includes(agentPhase(states[paneId])) ? [{ workspace, paneId, position: index + 1, state: states[paneId] }] : []
  )).sort((a, b) => (agentNeedsAttention(a.state) ? priority[a.state.status] : 2 + priority[a.state.status]) - (agentNeedsAttention(b.state) ? priority[b.state.status] : 2 + priority[b.state.status]));
}
