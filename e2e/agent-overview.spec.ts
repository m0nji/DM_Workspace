import { test, expect, _electron as electron } from '@playwright/test';
import type { StoreState } from '../src/renderer/store';

declare global { interface Window { __store: { getState(): StoreState; setState(patch: Partial<StoreState>): void }; } }

test('overview updates attention, reveals hidden agents and supports keyboard and empty state', async () => {
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    const trigger = win.getByRole('button', { name: 'Agent overview', exact: true });
    await trigger.click();
    const dialog = win.getByRole('alertdialog');
    await expect(dialog).toContainText('No agents connected yet');
    await win.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await win.evaluate(() => window.__store.setState({
      workspaces: [
        { id: 'a', name: 'Website', cwd: '/tmp', layout: { type: 'pane', id: 'a1' } },
        { id: 'b', name: 'Services', cwd: '/tmp', groupId: 'g', paneTitles: { b1: 'Worker' }, layout: { type: 'pane', id: 'b1' } }
      ], workspaceGroups: [{ id: 'g', name: 'Backend', collapsed: true }], activeWorkspaceId: 'a', focusedPaneId: 'a1', maximizedPaneId: 'a1'
    }));
    await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.b1)).toBe('atPrompt');
    await win.evaluate(() => window.__store.setState({ agentStates: {
      a1: { provider: 'claude', status: 'working', sessionId: 'a', event: 'UserPromptSubmit', updatedAt: Date.now() },
      b1: { provider: 'codex', status: 'needs-input', sessionId: 'b', event: 'PermissionRequest', updatedAt: Date.now() }
    } }));
    await expect(trigger.locator('.agent-attention-count')).toHaveText('1');
    await trigger.click();
    const rows = dialog.locator('.agent-overview-row');
    await expect(rows).toHaveCount(2);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toHaveCount(1);
    await expect(rows.first()).toContainText('Worker');
    await expect(rows.first()).toContainText('Codex · Needs input');
    await expect(dialog.getByRole('button', { name: 'Close', exact: true }).last()).toBeFocused();
    await win.keyboard.press('Tab');
    await expect(rows.first()).toBeFocused();
    await win.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => win.evaluate(() => window.__store.getState().activeWorkspaceId)).toBe('b');
    await expect(win.locator('.pane:visible .xterm-helper-textarea')).toBeFocused();
    await trigger.click();
    await win.evaluate(() => window.__store.getState().setAgentState('b1', { provider: 'codex', status: 'completed', sessionId: 'b', event: 'Stop', updatedAt: Date.now() }));
    await expect(trigger.locator('.agent-attention-count')).toHaveCount(0);
    await expect(rows.last()).toContainText('Response ended');
    await win.screenshot({ path: '/tmp/dmws-agent-overview.png' });
    await win.evaluate(() => window.__store.setState({ workspaces: window.__store.getState().workspaces.filter(w => w.id !== 'b') }));
    await expect(rows).toHaveCount(1);
  } finally { await app.close(); }
});
