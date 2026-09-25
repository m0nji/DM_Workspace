import type { AgentProfile } from '../shared/agent-profiles';
import type { AgentCheck } from '../shared/types';
import { useStore, type AgentLaunchIssue } from './store';

export type ProfileStartResult = 'started' | 'prompt-required' | 'setup-error' | 'cancelled' | AgentCheck;

// Start a profile in an existing pane at its free prompt: the agent dialog and
// the "Try again" notice use the same path. isCurrent lets a closed dialog
// discard late results.
export async function startProfileInPane(paneId: string, profile: AgentProfile, cwd: string, isCurrent: () => boolean = () => true): Promise<ProfileStartResult> {
  if (useStore.getState().paneShell[paneId] !== 'atPrompt') return 'prompt-required';
  let check: AgentCheck;
  try { check = await window.api.checkAgentStart(paneId, profile, cwd); } catch { check = 'check-failed'; }
  if (!isCurrent()) return 'cancelled';
  if (check !== 'ready') return check;
  let setup: Awaited<ReturnType<typeof window.api.prepareAgentStatus>>;
  try { setup = await window.api.prepareAgentStatus(paneId, profile); } catch { return 'setup-error'; }
  if (!isCurrent()) return 'cancelled';
  return useStore.getState().startAgentInPane(paneId, setup.launchCommand, setup.inputPrefix, profile.command) ? 'started' : 'prompt-required';
}

export function launchIssueKey(check: AgentLaunchIssue['check']): string {
  if (check === 'prompt-required') return 'agent.promptRequired';
  if (check === 'setup-error') return 'agent.setupError';
  return `agent.startErrors.${check}`;
}
