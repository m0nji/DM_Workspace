import { useMemo } from 'react';
import { resolveAgentProfiles, type AgentProfile } from '../shared/agent-profiles';
import { useStore } from './store';

// Select the raw fields and memoize: resolveAgentProfiles returns a fresh array,
// which must never be a zustand selector result (endless re-render).
export function useAgentProfiles(): AgentProfile[] {
  const agentProfiles = useStore(s => s.settings.agentProfiles);
  const agentRemoteControl = useStore(s => s.settings.agentRemoteControl);
  return useMemo(() => resolveAgentProfiles({ agentProfiles, agentRemoteControl }), [agentProfiles, agentRemoteControl]);
}
