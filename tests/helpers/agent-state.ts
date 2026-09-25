import type { AgentState } from '../../src/shared/agent-state';

export function agentState(patch: Partial<AgentState> = {}): AgentState {
  return { adapter: 'codex', profileId: 'codex', profileName: 'Codex', icon: { kind: 'logo', logo: 'openai' },
    status: 'unknown', sessionId: null, event: 'setup', updatedAt: 1, ...patch };
}
