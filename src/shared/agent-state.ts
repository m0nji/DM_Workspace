export type AgentStatus = 'unknown' | 'working' | 'needs-input' | 'completed' | 'error';
export interface AgentState {
  provider: 'claude' | 'codex';
  status: AgentStatus;
  sessionId: string | null;
  event: string;
  updatedAt: number;
}
export interface AgentStateEvent { paneId: string; state: AgentState | null }

// Only explicit parent-session evidence. Never infer completion from output,
// a successful tool, a child task, or an idle notification.
export function claudeState(input: Record<string, unknown>): AgentStatus | null {
  if (input.agent_id) return null;
  switch (input.hook_event_name) {
    case 'SessionStart': case 'SessionEnd': return 'unknown';
    case 'UserPromptSubmit': case 'PostToolBatch': case 'PostToolUse': case 'PostToolUseFailure': case 'ElicitationResult': return 'working';
    case 'PreToolUse': return input.tool_name === 'AskUserQuestion' ? 'needs-input' : 'working';
    case 'PermissionRequest': case 'Elicitation': return 'needs-input';
    case 'Notification':
      return ['permission_prompt', 'elicitation_dialog', 'elicitation_url_dialog', 'agent_needs_input']
        .includes(String(input.notification_type)) ? 'needs-input' : null;
    case 'Stop':
      if (input.stop_hook_active === true ||
          (Array.isArray(input.background_tasks) && input.background_tasks.length > 0) ||
          (Array.isArray(input.session_crons) && input.session_crons.length > 0)) return 'unknown';
      return 'completed';
    case 'StopFailure': return 'error';
    default: return null;
  }
}

export function codexState(input: Record<string, unknown>): AgentStatus | null {
  if (input.agent_id) return null;
  switch (input.hook_event_name) {
    case 'UserPromptSubmit': case 'PreToolUse': case 'PostToolUse': case 'PreCompact': case 'PostCompact': return 'working';
    case 'PermissionRequest': return 'needs-input';
    case 'Stop': return input.stop_hook_active === true ? 'unknown' : 'completed';
    case 'Interrupt': case 'SessionEnd': return 'unknown';
    default: return null;
  }
}
