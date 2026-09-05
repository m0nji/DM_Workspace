import { describe, expect, it } from 'vitest';
import { claudeState } from '../src/shared/agent-state';

describe('explicit Claude state', () => {
  it.each([
    ['SessionStart', 'unknown'], ['UserPromptSubmit', 'working'], ['PermissionRequest', 'needs-input'],
    ['PostToolUse', 'working'], ['Stop', 'completed'], ['StopFailure', 'error'], ['SessionEnd', 'unknown']
  ])('maps %s to %s without output heuristics', (hook_event_name, status) => {
    expect(claudeState({ hook_event_name })).toBe(status);
  });
  it('does not mistake a recoverable tool error for a failed turn', () => {
    expect(claudeState({ hook_event_name: 'PostToolUseFailure' })).toBe('working');
  });
  it('ignores child-agent events', () => {
    expect(claudeState({ hook_event_name: 'Stop', agent_id: 'child' })).toBeNull();
  });
  it('does not call outstanding background work complete', () => {
    expect(claudeState({ hook_event_name: 'Stop', background_tasks: [{}] })).toBe('unknown');
    expect(claudeState({ hook_event_name: 'Stop', session_crons: [{}] })).toBe('unknown');
    expect(claudeState({ hook_event_name: 'Stop', stop_hook_active: true })).toBe('unknown');
  });
  it('recognizes permission and question events, but not idle/output as completion', () => {
    expect(claudeState({ hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion' })).toBe('needs-input');
    expect(claudeState({ hook_event_name: 'Notification', notification_type: 'permission_prompt' })).toBe('needs-input');
    expect(claudeState({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })).toBeNull();
    expect(claudeState({ hook_event_name: 'SubagentStop' })).toBeNull();
    expect(claudeState({ hook_event_name: 'output' })).toBeNull();
  });
});
