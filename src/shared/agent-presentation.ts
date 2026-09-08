import type { AgentState } from './agent-state';
import type { PaneShellState } from './types';

export type AgentPhase = 'ready' | 'waiting' | 'live' | 'paused' | 'ended' | 'ending' | 'unsupported' | 'interrupted';

// Process lifetime and transport readiness are separate from the last work event.
export function agentPhase(state: AgentState, shell?: PaneShellState): AgentPhase {
  if (state.event === 'shell') return 'ended';
  if (state.event === 'SessionEnd') return 'ending';
  if (state.paused) return 'paused';
  if (state.event === 'setup' && shell === 'atPrompt') return 'ready';
  if (state.provider === 'opencode') return 'unsupported';
  if (state.event === 'interrupted' || state.event === 'Interrupt') return 'interrupted';
  return state.sessionId ? 'live' : 'waiting';
}

export function agentLabelKey(state: AgentState, shell?: PaneShellState): `agent.state.${AgentState['status']}` | `agent.phase.${Exclude<AgentPhase, 'live'>}` {
  const phase = agentPhase(state, shell);
  return phase === 'live' ? `agent.state.${state.status}` : `agent.phase.${phase}`;
}

export function agentNeedsAttention(state: AgentState): boolean {
  return agentPhase(state) === 'live' && (state.status === 'needs-input' || state.status === 'error');
}
