import { test, expect, _electron as electron } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';

test('Claude setup and explicit events drive only the target pane, with no silence completion', async () => {
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => {
      const store = (window as unknown as { __store: { setState(p: unknown): void } }).__store;
      store.setState({ workspaces: [{ id: 'w', name: 'Agent test', cwd: '/tmp', layout: {
        type: 'split', id: 's', direction: 'h', ratio: 0.5,
        children: [{ type: 'pane', id: 'agent1' }, { type: 'pane', id: 'agent2' }]
      } }], activeWorkspaceId: 'w' });
    });
    const panes = win.locator('.pane');
    await expect(panes).toHaveCount(2);
    await expect(panes.first().locator('.pane-title:visible')).not.toHaveText('');
    // Wait for shell startup, so the setup cannot race the initial PTY spawn.
    await expect.poll(() => win.evaluate(() => (window as unknown as {
      __store: { getState(): { paneShell: Record<string, string> } }
    }).__store.getState().paneShell.agent1)).toBe('atPrompt');
    await win.evaluate(() => window.api.input({ paneId: 'agent1', data: 'node -p "process.env.DMWS_AGENT_NONCE"\r' }));
    const readNonce = () => win.evaluate(() => {
      const text = (window as unknown as { __bufferText: Map<string, () => string> }).__bufferText.get('agent1')!();
      return text.split('\n').map(line => line.trim()).find(line => /^[a-f0-9]{64}$/.test(line));
    });
    await expect.poll(readNonce).toMatch(/^[a-f0-9]{64}$/);
    const nonce = await readNonce();
    await panes.first().getByRole('button', { name: 'Agent status', exact: true }).click();
    const dialog = win.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await win.screenshot({ path: '/tmp/dmws-agent-setup.png' });
    const command = await dialog.locator('code').textContent();
    expect(command).toMatch(/^claude --settings '/);
    const settingsPath = command!.slice("claude --settings '".length, -1).replace(/'\\''/g, "'");
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    const hook = settings.hooks.UserPromptSubmit[0].hooks[0];
    await dialog.getByRole('button', { name: 'Copy start command' }).click();
    await expect(dialog).toHaveCount(0);
    const emit = async (hook_event_name: string) => {
      const response = await fetch(hook.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...hook.headers, 'X-DMWS-Terminal': nonce! },
        body: JSON.stringify({ hook_event_name, session_id: 'e2e-session' }) });
      expect(response.status).toBe(200);
    };
    await emit('UserPromptSubmit');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Working');
    await win.waitForTimeout(2500); // Deliberately exceed the terminal-output silence window.
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Working');
    await expect(panes.nth(1).locator('.pane-agent-status')).toHaveText('Agent');
    await emit('PermissionRequest');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Needs input');
    await emit('PostToolUse');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Needs input');
    await emit('PostToolBatch');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Working');
    await win.screenshot({ path: '/tmp/dmws-agent-panes.png' });
    await emit('Stop');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Response ended');
    await emit('StopFailure');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Error');
    await emit('SessionEnd');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Claude · Unknown');
    await panes.first().getByRole('button', { name: 'Agent status', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Copy start command' })).toBeFocused();
    await win.keyboard.press('Tab');
    await expect(dialog.getByRole('combobox', { name: 'Agent', exact: true })).toBeFocused();
    await dialog.getByRole('combobox', { name: 'Agent', exact: true }).selectOption('codex');
    await expect(dialog.locator('code')).toContainText('codex -c');
    await expect(dialog).toContainText('/hooks');
    await win.screenshot({ path: '/tmp/dmws-codex-setup.png' });
    const setup = await win.evaluate(() => window.api.prepareAgentStatus('agent1', 'codex'));
    await dialog.getByRole('button', { name: 'Copy start command' }).click();
    const postCodex = async (hook_event_name: string) => {
      const child = spawn(process.execPath, [setup.settingsPath], { env: { ...process.env, DMWS_AGENT_NONCE: nonce! }, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdin.end(JSON.stringify({ session_id: 'codex-e2e', turn_id: 'turn1', hook_event_name }));
      const [code] = await once(child, 'close');
      expect(code).toBe(0);
    };
    await postCodex('UserPromptSubmit');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Codex · Working');
    await postCodex('PermissionRequest');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Codex · Needs input');
    await postCodex('Stop');
    await expect(panes.first().locator('.pane-agent-status')).toHaveText('Codex · Response ended');
    await expect(panes.nth(1).locator('.pane-agent-status')).toHaveText('Agent');
  } finally { await app.close(); }
});
