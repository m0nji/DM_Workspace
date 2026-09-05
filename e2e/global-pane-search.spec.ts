import { test, expect, _electron as electron } from '@playwright/test';
import type { StoreState } from '../src/renderer/store';

declare global { interface Window { __store: { getState(): StoreState; setState(patch: Partial<StoreState>): void }; } }

test('finds hidden panes by combined metadata and hands them keyboard focus', async () => {
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => window.__store.setState({
      workspaces: [
        { id: 'a', name: 'Website', cwd: '/tmp', layout: { type: 'pane', id: 'a1' } },
        { id: 'b', name: 'Services', cwd: '/tmp', groupId: 'g', paneTitles: { b1: 'Worker', b2: 'Logs' }, layout: {
          type: 'split', id: 's', direction: 'h', ratio: 0.5,
          children: [{ type: 'pane', id: 'b1' }, { type: 'pane', id: 'b2' }]
        } }
      ],
      workspaceGroups: [{ id: 'g', name: 'Backend', collapsed: true }],
      activeWorkspaceId: 'a', focusedPaneId: 'a1', maximizedPaneId: 'a1'
    }));
    await expect(win.locator('.pane:visible')).toHaveCount(1);
    await win.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P');
    const input = win.locator('.command-input');
    await expect(input).toBeFocused();
    await input.fill('logs services backend /tmp');
    await expect(win.getByRole('option')).toHaveCount(1);
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(win.locator('.pane:visible')).toHaveCount(2);
    const target = win.locator('.pane:visible').filter({ has: win.locator('.pane-label', { hasText: 'Logs' }) });
    await expect(target.getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
    expect(await win.evaluate(() => ({
      active: window.__store.getState().activeWorkspaceId,
      focused: window.__store.getState().focusedPaneId,
      collapsed: window.__store.getState().workspaceGroups[0].collapsed
    }))).toEqual({ active: 'b', focused: 'b2', collapsed: false });

    // The initially highlighted result also keeps its identity when ranking changes.
    await win.evaluate(() => window.__store.getState().setCommandPaletteOpen(true));
    await expect(input).toBeFocused();
    await input.fill('services terminals');
    await expect(win.getByRole('option', { selected: true })).toContainText('Logs');
    await win.evaluate(() => window.__store.getState().setPaneTitle('b1', 'A'));
    await expect(win.getByRole('option').first()).toContainText('Pane 1');
    await expect(win.getByRole('option', { selected: true })).toContainText('Logs');
    await input.press('Enter');
    await expect(target.getByRole('textbox', { name: 'Terminal input' })).toBeFocused();

    // Metadata changes while open must update the search results.
    await win.evaluate(() => window.__store.getState().setCommandPaletteOpen(true));
    await expect(input).toBeFocused();
    await input.fill('fresh-title /live/path');
    await expect(win.getByRole('option')).toHaveCount(0);
    await win.evaluate(() => {
      window.__store.getState().setPaneTitle('b1', 'fresh-title');
      window.__store.getState().setPaneCwd('b1', '/live/path');
    });
    await expect(win.getByRole('option')).toHaveCount(1);
    await input.press('Enter');
    await expect(win.locator('.pane:visible').filter({ hasText: 'fresh-title' }).getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
    // Closing another pane must not lose the selected search result.
    await win.evaluate(() => window.__store.getState().setCommandPaletteOpen(true));
    await expect(input).toBeFocused();
    await input.fill('services terminals');
    await expect(win.getByRole('option')).toHaveCount(2);
    await input.press('ArrowDown');
    await expect(win.getByRole('option', { selected: true })).toContainText('fresh-title');
    await win.evaluate(() => window.__store.setState({
      workspaces: window.__store.getState().workspaces.map(w => w.id === 'b'
        ? { ...w, layout: { type: 'pane' as const, id: 'b1' } } : w)
    }));
    await expect(win.getByRole('option')).toHaveCount(1);
    await expect(win.getByRole('option', { selected: true })).toContainText('fresh-title');
    await input.press('Enter');
    await expect(input).toHaveCount(0);
    await expect(win.locator('.pane:visible').getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
  } finally { await app.close(); }
});


test('titlebar search opens a focused pane-only search and command palette still shows actions', async () => {
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => window.__store.setState({
      workspaces: [{ id: 'search-ws', name: 'Search workspace', cwd: '/tmp',
        paneTitles: { 'search-pane': 'Monitoring' }, layout: { type: 'pane', id: 'search-pane' } }],
      activeWorkspaceId: 'search-ws'
    }));
    await win.getByRole('button', { name: 'Search all terminals', exact: true }).click();
    const input = win.locator('.command-input');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('placeholder', 'Search all terminals…');
    await expect(win.getByRole('option')).toHaveCount(1);
    await input.fill('Monitoring');
    await win.getByRole('option').click();
    await expect(input).toHaveCount(0);
    await expect(win.locator('.pane').getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
    await win.getByRole('button', { name: 'Command palette', exact: true }).click();
    await expect(input).toBeFocused();
    await expect(win.getByRole('option').filter({ has: win.getByText('New workspace', { exact: true }) })).toBeVisible();
  } finally { await app.close(); }
});
