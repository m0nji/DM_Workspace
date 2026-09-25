import type { PaneShellState } from './types';

// Launch state of an agent spawned together with its pane, as far as the one
// boot prompt of that pane is concerned: 'pending' until pty:spawn answers,
// then 'started' (main typed the launch line) or 'failed' (check failed, the
// shell stays usable). null once the boot prompt has been consumed, and for
// every pane that was not spawned for an agent.
export type AgentBootLaunch = 'pending' | 'started' | 'failed';

export interface PromptMarkerDecision {
  // Tell main the shell returned (retires the agent registration). Never for
  // the boot prompt: it precedes the launch instead of following an agent.
  reportShellReturn: boolean;
  // Main writes the launch line itself, so no renderer input marks the pane
  // 'running'. Once the launch started, the boot prompt — however late its
  // marker is parsed — must not put the pane back 'atPrompt', or the agent
  // dialog shows "Start prepared" and offers to type a start line into the
  // running program. Only a pending or failed launch leaves 'atPrompt', so
  // "Try again" works; a later 'started' result marks the pane running.
  shell: Extract<PaneShellState, 'atPrompt' | 'running'>;
}

export function promptMarkerDecision(bootLaunch: AgentBootLaunch | null): PromptMarkerDecision {
  if (bootLaunch === null) return { reportShellReturn: true, shell: 'atPrompt' };
  return { reportShellReturn: false, shell: bootLaunch === 'started' ? 'running' : 'atPrompt' };
}
