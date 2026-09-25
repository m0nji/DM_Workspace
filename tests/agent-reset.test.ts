import { describe, expect, it } from 'vitest';
import { agentResetPlan, liveResetEntries, type AgentResetState } from '../src/renderer/agent-reset';
import { agentState } from './helpers/agent-state';

function stateFrom(patch: Partial<AgentResetState>): AgentResetState {
  return { agentStates: {}, paneShell: {}, paneDetectedAgents: {}, ...patch };
}

describe('agentResetPlan', () => {
  it('leaves a plain shell (no agent) in clearOnly', () => {
    const plan = agentResetPlan(['p1'], stateFrom({ paneShell: { p1: 'running' } }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['p1'] });
  });

  it('resets an idle launched claude pane with /clear', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'completed', event: 'Stop' }) }
    }));
    expect(plan).toEqual({ reset: [{ paneId: 'p1', command: '/clear' }], busy: [], clearOnly: [] });
  });

  it('resets an idle launched codex pane with /new', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'codex', sessionId: 's1', status: 'completed', event: 'Stop' }) }
    }));
    expect(plan).toEqual({ reset: [{ paneId: 'p1', command: '/new' }], busy: [], clearOnly: [] });
  });

  it('resets an idle launched opencode pane with /new', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'opencode', sessionId: null, status: 'unknown', event: 'setup' }) }
    }));
    expect(plan).toEqual({ reset: [{ paneId: 'p1', command: '/new' }], busy: [], clearOnly: [] });
  });

  it('puts a generic agent pane in clearOnly (no known command)', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'generic', sessionId: null, status: 'unknown', event: 'setup' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['p1'] });
  });

  it('marks a working agent as busy (display cleared only, no command sent)', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'working', event: 'PostToolUse' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: ['p1'], clearOnly: [] });
  });

  it('marks a needs-input agent as busy', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'needs-input', event: 'PermissionRequest' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: ['p1'], clearOnly: [] });
  });

  it('puts an ended agent pane in clearOnly', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'completed', event: 'shell' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['p1'] });
  });

  it('resets a manually-detected claude pane with no agentState', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      paneDetectedAgents: { p1: 'claude' }
    }));
    expect(plan).toEqual({ reset: [{ paneId: 'p1', command: '/clear' }], busy: [], clearOnly: [] });
  });

  it('puts a remote pane key in clearOnly regardless of agent state', () => {
    const plan = agentResetPlan(['r:server1:user:p1'], stateFrom({
      paneShell: { 'r:server1:user:p1': 'running' },
      paneDetectedAgents: { 'r:server1:user:p1': 'claude' }
    }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['r:server1:user:p1'] });
  });

  it('puts a pane at prompt with a stale (leftover) agentState in clearOnly', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'atPrompt' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'completed', event: 'Stop' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['p1'] });
  });

  // No conversation is bound yet: hooks only bind a session on the first
  // submitted prompt, so a freshly-launched pane with sessionId:null ('waiting')
  // may still be showing a trust/login prompt rather than its own conversation
  // prompt. Sending "/clear" there would type into the wrong screen.
  it('puts a freshly-launched claude pane (waiting, no session yet) in clearOnly', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: null, status: 'unknown', event: 'setup' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['p1'] });
  });

  it('puts a freshly-launched codex pane (waiting, no session yet) in clearOnly', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'codex', sessionId: null, status: 'unknown', event: 'setup' }) }
    }));
    expect(plan).toEqual({ reset: [], busy: [], clearOnly: ['p1'] });
  });

  it('resets a paused agent (no busy check applies once paused)', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'working', event: 'PostToolUse', paused: true }) }
    }));
    expect(plan).toEqual({ reset: [{ paneId: 'p1', command: '/clear' }], busy: [], clearOnly: [] });
  });

  it('resets an interrupted agent', () => {
    const plan = agentResetPlan(['p1'], stateFrom({
      paneShell: { p1: 'running' },
      agentStates: { p1: agentState({ adapter: 'claude', sessionId: 's1', status: 'unknown', event: 'interrupted' }) }
    }));
    expect(plan).toEqual({ reset: [{ paneId: 'p1', command: '/clear' }], busy: [], clearOnly: [] });
  });
});

describe('liveResetEntries', () => {
  it('drops reset entries for panes that no longer exist in any workspace layout', () => {
    const reset = [{ paneId: 'p1', command: '/clear' }, { paneId: 'p2', command: '/new' }];
    expect(liveResetEntries(reset, ['p1'])).toEqual([{ paneId: 'p1', command: '/clear' }]);
  });

  it('keeps every entry when all panes still exist', () => {
    const reset = [{ paneId: 'p1', command: '/clear' }];
    expect(liveResetEntries(reset, ['p1', 'p2'])).toEqual(reset);
  });

  it('returns an empty array when nothing is live', () => {
    expect(liveResetEntries([{ paneId: 'p1', command: '/clear' }], [])).toEqual([]);
  });
});
