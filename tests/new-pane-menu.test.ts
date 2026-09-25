import { expect, it } from 'vitest';
import { newPaneMenuEntries } from '../src/renderer/new-pane-menu';
import { builtinAgentProfiles } from '../src/shared/agent-profiles';

it('lists terminal first, then visible profiles in settings order', () => {
  const profiles = builtinAgentProfiles();
  profiles[1].showInMenu = false;
  expect(newPaneMenuEntries(profiles, false).map(e => e.key)).toEqual(['terminal', 'agent:claude', 'agent:opencode']);
});
it('disables every agent row in remote workspaces but never the terminal', () => {
  const entries = newPaneMenuEntries(builtinAgentProfiles(), true);
  expect(entries.map(e => e.disabled)).toEqual([false, true, true, true]);
});
