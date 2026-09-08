import { expect, it } from 'vitest';
import { agentPhase, agentLabelKey, agentNeedsAttention } from '../src/shared/agent-presentation';
import { agentOverview } from '../src/renderer/agent-overview';
import type { AgentState } from '../src/shared/agent-state';
const state: AgentState = { provider: 'codex', event: 'setup', status: 'unknown', sessionId: null, updatedAt: 1 };
it('does not claim a running CLI has confirmed status reporting', () => {
  expect(agentPhase(state, 'atPrompt')).toBe('ready');
  expect(agentPhase(state, 'running')).toBe('waiting');
  expect(agentPhase({ ...state, sessionId: 's', event: 'UserPromptSubmit', status: 'working' })).toBe('live');
  expect(agentLabelKey({ ...state, provider: 'opencode' }, 'running')).toBe('agent.phase.unsupported');
});
it('distinguishes interrupt, paused display, session shutdown and returned shell', () => {
  expect(agentPhase({ ...state, event: 'interrupted' })).toBe('interrupted');
  expect(agentPhase({ ...state, paused: true })).toBe('paused');
  expect(agentPhase({ ...state, event: 'SessionEnd' })).toBe('ending');
  expect(agentPhase({ ...state, event: 'shell', paused: true }, 'atPrompt')).toBe('ended');
});
it('keeps paused and ended sessions out of attention and active overview', () => {
  const paused: AgentState = { ...state, paused: true, status: 'needs-input', sessionId: 's' };
  expect(agentNeedsAttention(paused)).toBe(false);
  expect(agentOverview([{ id: 'w', name: 'w', cwd: '/tmp', layout: { type: 'split', id: 's', direction: 'h', ratio: 0.5, children: [{ type: 'pane', id: 'p' }, { type: 'pane', id: 'e' }] } }], { p: paused, e: { ...state, event: 'shell' } })).toEqual([]);
});
