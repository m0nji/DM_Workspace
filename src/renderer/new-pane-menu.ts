import type { AgentProfile } from '../shared/agent-profiles';

export type NewPaneMenuEntry =
  | { key: 'terminal'; kind: 'terminal'; disabled: false }
  | { key: string; kind: 'agent'; profile: AgentProfile; disabled: boolean };

// Remote workspaces have no agent start (ipc-validate rejects it); their rows
// stay visible but disabled so the menu looks the same everywhere.
export function newPaneMenuEntries(profiles: AgentProfile[], remote: boolean): NewPaneMenuEntry[] {
  return [
    { key: 'terminal', kind: 'terminal', disabled: false },
    ...profiles.filter(p => p.showInMenu).map(profile => ({ key: `agent:${profile.id}`, kind: 'agent' as const, profile, disabled: remote }))
  ];
}
