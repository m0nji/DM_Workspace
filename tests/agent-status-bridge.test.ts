import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { request } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { AgentStatusBridge } from '../src/main/agent-status-bridge';
import type { AgentStateEvent } from '../src/shared/agent-state';

describe('agent status bridge', () => {
  let dir: string;
  let bridge: AgentStatusBridge;
  let events: AgentStateEvent[];
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dmws-agent-test-'));
    events = [];
    bridge = new AgentStatusBridge(dir, e => events.push(e));
  });
  afterEach(async () => { await bridge.close(); rmSync(dir, { recursive: true, force: true }); });
  async function setup(paneId = 'p1') {
    const result = await bridge.prepare(paneId, '/bin/zsh', 'a'.repeat(64));
    const settings = JSON.parse(readFileSync(result.settingsPath, 'utf8'));
    const hook = settings.hooks.UserPromptSubmit[0].hooks[0];
    const post = (body: unknown, headers = { ...hook.headers, 'X-DMWS-Terminal': 'a'.repeat(64) }) => fetch(hook.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
    });
    return { result, hook, post };
  }
  it('runs Codex command hooks, protects turns and preserves ambiguous permission waits', async () => {
    const result = await bridge.prepare('p1', '/bin/zsh', 'a'.repeat(64), 'codex');
    const post = async (event: string, turn = 't1', extra = {}) => {
      const child = spawn(process.execPath, [result.settingsPath], {
        env: { ...process.env, DMWS_AGENT_NONCE: 'a'.repeat(64) }, stdio: ['pipe', 'pipe', 'pipe']
      });
      let output = '';
      child.stdout.on('data', data => { output += data; });
      child.stdin.end(JSON.stringify({ session_id: 's1', turn_id: turn, hook_event_name: event, prompt: 'PRIVATE', ...extra }));
      const [code] = await once(child, 'close');
      expect(code).toBe(0);
      expect(output.trim()).toBe('{}');
    };
    await post('UserPromptSubmit');
    expect(bridge.snapshot('p1')).toMatchObject({ provider: 'codex', status: 'working' });
    await expect(bridge.prepare('p1', '/bin/zsh', 'a'.repeat(64), 'claude')).rejects.toThrow();
    await post('PermissionRequest');
    await post('PostToolUse', 't1', { tool_use_id: 'unrelated' });
    expect(bridge.snapshot('p1')?.status).toBe('needs-input');
    await post('Stop');
    expect(bridge.snapshot('p1')?.status).toBe('completed');
    await post('UserPromptSubmit', 't2');
    await post('UserPromptSubmit', 'child-turn', { agent_id: 'child' });
    await post('Stop', 't1');
    expect(bridge.snapshot('p1')?.status).toBe('working');
    await post('Interrupt', 't2');
    await post('Stop', 't2');
    expect(bridge.snapshot('p1')?.status).toBe('unknown');
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    bridge.release('p1');
    expect(existsSync(result.settingsPath)).toBe(false);
  });
  it('receives authenticated lifecycle events without storing prompt or transcript data', async () => {
    const { post } = await setup();
    expect((await post({ session_id: 's1', hook_event_name: 'UserPromptSubmit' })).status).toBe(200);
    await post({ session_id: 's1', hook_event_name: 'UserPromptSubmit', prompt: 'PRIVATE', transcript_path: 'PRIVATE' });
    expect(events.at(-1)).toMatchObject({ paneId: 'p1', state: { status: 'working', sessionId: 's1' } });
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
    await post({ session_id: 's1', hook_event_name: 'Stop' });
    expect(events.at(-1)?.state?.status).toBe('completed');
  });
  it('rejects bad tokens, browser requests and oversized bodies', async () => {
    const { post, hook } = await setup();
    expect((await post({}, { Authorization: 'Bearer bad' })).status).toBe(401);
    expect((await post({}, { ...hook.headers, 'X-DMWS-Terminal': 'a'.repeat(64), Origin: 'https://example.com' })).status).toBe(403);
    expect((await post({ text: 'x'.repeat(300_000) })).status).toBe(413);
    expect(bridge.snapshot('p1')?.status).toBe('unknown');
  });
  it('isolates panes and rejects ended-session and closed-pane events', async () => {
    const a = await setup('a'), b = await setup('b');
    await a.post({ session_id: 'old', hook_event_name: 'UserPromptSubmit' });
    await a.post({ session_id: 'old', hook_event_name: 'SessionEnd' });
    await a.post({ session_id: 'new', hook_event_name: 'UserPromptSubmit' });
    await a.post({ session_id: 'new', hook_event_name: 'PermissionRequest' });
    await a.post({ session_id: 'old', hook_event_name: 'Stop' });
    expect(bridge.snapshot('a')?.status).toBe('needs-input');
    expect(bridge.snapshot('b')?.status).toBe('unknown');
    bridge.release('a');
    expect((await a.post({ session_id: 'new', hook_event_name: 'Stop' })).status).toBe(401);
    expect(existsSync(a.result.settingsPath)).toBe(false);
    expect((await b.post({ session_id: 'b', hook_event_name: 'UserPromptSubmit' })).status).toBe(200);
  });
  it('requires a first prompt, ignores child events and clears on interruption and shell return', async () => {
    const { post } = await setup();
    await post({ session_id: 's', hook_event_name: 'Stop' });
    expect(bridge.snapshot('p1')?.status).toBe('unknown');
    await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
    await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
    await post({ session_id: 's', hook_event_name: 'Stop', agent_id: 'child' });
    expect(bridge.snapshot('p1')?.status).toBe('working');
    bridge.interrupt('p1');
    await post({ session_id: 's', hook_event_name: 'Stop' });
    expect(bridge.snapshot('p1')?.status).toBe('unknown');
    bridge.shellReturned('p1');
    await post({ session_id: 's', hook_event_name: 'Stop' });
    expect(bridge.snapshot('p1')?.status).toBe('unknown');
  });
  it('keeps outstanding questions visible across parallel tool events', async () => {
    const { post } = await setup();
    await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
    await post({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'a' });
    await post({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_use_id: 'b' });
    await post({ session_id: 's', hook_event_name: 'PostToolUse', tool_use_id: 'other' });
    expect(bridge.snapshot('p1')?.status).toBe('needs-input');
    await post({ session_id: 's', hook_event_name: 'PostToolUse', tool_use_id: 'a' });
    expect(bridge.snapshot('p1')?.status).toBe('needs-input');
    await post({ session_id: 's', hook_event_name: 'PostToolUse', tool_use_id: 'b' });
    expect(bridge.snapshot('p1')?.status).toBe('working');
  });
  it('clears real permission requests without IDs only once the entire tool batch resolves', async () => {
    const { post } = await setup();
    await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
    // PermissionRequest has no tool_use_id in the actual Claude hook schema.
    await post({ session_id: 's', hook_event_name: 'PermissionRequest', tool_name: 'Bash' });
    await post({ session_id: 's', hook_event_name: 'PostToolUse', tool_use_id: 'unrelated' });
    expect(bridge.snapshot('p1')?.status).toBe('needs-input');
    await post({ session_id: 's', hook_event_name: 'PostToolBatch' });
    expect(bridge.snapshot('p1')?.status).toBe('working');
  });
  it('rejects a config used in a different terminal and uses only HTTP-capable hooks', async () => {
    const { post, hook, result } = await setup();
    expect((await post({}, { ...hook.headers, 'X-DMWS-Terminal': 'b'.repeat(64) })).status).toBe(401);
    const config = JSON.parse(readFileSync(result.settingsPath, 'utf8'));
    expect(config.hooks.SessionStart).toBeUndefined();
    expect(config.hooks.UserPromptSubmit[0].hooks[0].allowedEnvVars).toContain('DMWS_AGENT_NONCE');
  });
  it('does not revive a released pane from an oversized in-flight request', async () => {
    const { hook } = await setup();
    const req = request(hook.url, { method: 'POST', headers: {
      ...hook.headers, 'X-DMWS-Terminal': 'a'.repeat(64), 'Content-Type': 'application/json', Expect: '100-continue'
    } });
    const response = once(req, 'response');
    req.flushHeaders();
    await once(req, 'continue');
    bridge.release('p1');
    const count = events.length;
    req.end(JSON.stringify({ text: 'x'.repeat(300_000) }));
    const [res] = await response;
    res.resume();
    expect(events).toHaveLength(count);
    expect(events.at(-1)?.state).toBeNull();
  });
  it('prepares idempotently without replacing an active session and rejects unsupported shells', async () => {
    const { result, post } = await setup();
    await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
    await post({ session_id: 's', hook_event_name: 'UserPromptSubmit' });
    expect((await bridge.prepare('p1', '/bin/zsh', 'a'.repeat(64))).command).toBe(result.command);
    expect(bridge.snapshot('p1')?.status).toBe('working');
    await expect(bridge.prepare('p2', 'cmd.exe', 'b'.repeat(64))).rejects.toThrow('shell');
    expect((await bridge.prepare('p3', 'powershell.exe', 'c'.repeat(64))).command).toMatch(/^claude --settings '/);
  });
});
