// Pure decision module for "Fenster leeren" / "Alle Fenster leeren" with a
// running agent underneath: clearing only the xterm buffer leaves the agent's
// TUI alive and its conversation intact — it just redraws its prompt. This
// decides, per pane, whether clearing must also start a fresh agent
// conversation (reset), must leave the pane's work alone (busy — display
// cleared only, no command sent, so running work is never interrupted), or is
// a plain buffer clear as before (clearOnly).
import type { AgentState, AgentProvider } from '../shared/agent-state';
import type { PaneShellState } from '../shared/types';
import { agentPhase } from '../shared/agent-presentation';
import { isRemotePaneKey } from '../shared/remote-pane-key';

export interface AgentResetState {
  agentStates: Record<string, AgentState>;
  paneShell: Record<string, PaneShellState>;
  paneDetectedAgents: Record<string, AgentProvider>;
}

export interface AgentResetPlan {
  reset: Array<{ paneId: string; command: string }>;
  busy: string[];
  clearOnly: string[];
}

// The slash command each adapter understands for "start a new conversation,
// keep the process running". No entry (generic) means there is no known
// command, so those panes fall back to a plain buffer clear.
const RESET_COMMANDS: Record<AgentProvider, string> = { claude: '/clear', codex: '/new', opencode: '/new' };

export function agentResetPlan(paneIds: string[], state: AgentResetState): AgentResetPlan {
  const reset: Array<{ paneId: string; command: string }> = [];
  const busy: string[] = [];
  const clearOnly: string[] = [];

  for (const paneId of paneIds) {
    // Remote panes are server-owned sessions; clearing here is a local
    // display-only affordance, never a command sent into someone else's pane.
    if (isRemotePaneKey(paneId)) { clearOnly.push(paneId); continue; }

    const agentState = state.agentStates[paneId];
    const shell = state.paneShell[paneId];
    const detected = state.paneDetectedAgents[paneId];

    const phase = agentState ? agentPhase(agentState, shell) : null;
    // A leftover agentState from an already-exited process ('ended'/'ending')
    // is not a running agent — treat the pane like a plain shell.
    const hasLiveAgentState = !!agentState && phase !== 'ended' && phase !== 'ending';
    const runsAgent = shell === 'running' && (hasLiveAgentState || !!detected);

    if (!runsAgent) { clearOnly.push(paneId); continue; }

    if (agentState) {
      // 'waiting' (launched, no sessionId yet) and 'ready' (just set up) mean
      // no conversation is bound yet — the adapter's hooks only bind a session
      // on the first submitted prompt. The pane's screen may still be a
      // trust/login prompt rather than the agent's own conversation prompt, so
      // there is nothing to reset; treat it like a plain buffer clear.
      if (phase === 'waiting' || phase === 'ready') { clearOnly.push(paneId); continue; }

      if (phase === 'live' && (agentState.status === 'working' || agentState.status === 'needs-input')) {
        busy.push(paneId);
        continue;
      }

      // Everything else with a bound conversation ('live' idle, 'paused',
      // 'interrupted', 'unsupported' for opencode) has something to restart.
      const provider = agentState.adapter !== 'generic' ? agentState.adapter : undefined;
      const command = provider ? RESET_COMMANDS[provider] : undefined;
      if (command) reset.push({ paneId, command });
      else clearOnly.push(paneId);
      continue;
    }

    // No agentState: a manually-typed agent (paneDetectedAgents) — unchanged
    // from before, since there is no phase to reason about here.
    const command = detected ? RESET_COMMANDS[detected] : undefined;
    if (command) reset.push({ paneId, command });
    else clearOnly.push(paneId);
  }

  return { reset, busy, clearOnly };
}

// Cheap guard for the window between opening the confirm dialog (which
// snapshots the plan) and the user actually confirming: a reset pane may have
// been closed in between. Drop it rather than sending its command into a pane
// that no longer exists in any workspace layout.
export function liveResetEntries(
  reset: AgentResetPlan['reset'],
  livePaneIds: Iterable<string>
): AgentResetPlan['reset'] {
  const live = new Set(livePaneIds);
  return reset.filter(({ paneId }) => live.has(paneId));
}
