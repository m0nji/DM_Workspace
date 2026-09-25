import { agentPhase } from '../shared/agent-presentation';
import { builtinAgentProfile, type AgentIcon, type AgentProfile } from '../shared/agent-profiles';
import type { AgentProvider, AgentState } from '../shared/agent-state';
import type { PaneShellState } from '../shared/types';

export function paneAgentIdentity(state: AgentState | undefined, detected: AgentProvider | undefined,
  profiles: AgentProfile[], shell?: PaneShellState): { name: string; icon: AgentIcon } | null {
  if (state && agentPhase(state, shell) !== 'ended') return { name: state.profileName, icon: state.icon };
  if (!detected) return null;
  const profile = profiles.find(p => p.id === detected) ?? builtinAgentProfile(detected);
  return { name: profile.name, icon: profile.icon };
}
