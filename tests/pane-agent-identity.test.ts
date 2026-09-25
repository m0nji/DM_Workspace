import { expect, it } from 'vitest';
import { paneAgentIdentity } from '../src/renderer/pane-agent-identity';
import { builtinAgentProfile, builtinAgentProfiles } from '../src/shared/agent-profiles';
import { agentState } from './helpers/agent-state';

const profiles = builtinAgentProfiles();
it('prefers the launched profile snapshot over the detected command', () => {
  const state = agentState({ profileName: 'OpenCode (Ollama)', icon: { kind: 'letter', letter: 'O', color: '#c97b4a' } });
  expect(paneAgentIdentity(state, 'claude', profiles, 'running')).toEqual({ name: 'OpenCode (Ollama)', icon: state.icon });
});
it('falls back to the detected builtin with the user’s current name and icon', () => {
  const renamed = profiles.map(p => p.id === 'claude' ? { ...p, name: 'Mein Claude' } : p);
  expect(paneAgentIdentity(undefined, 'claude', renamed)).toEqual({ name: 'Mein Claude', icon: builtinAgentProfile('claude').icon });
});
it('shows nothing after the agent returned to the shell and without detection', () => {
  expect(paneAgentIdentity(agentState({ event: 'shell' }), undefined, profiles)).toBeNull();
  expect(paneAgentIdentity(undefined, undefined, profiles)).toBeNull();
});
