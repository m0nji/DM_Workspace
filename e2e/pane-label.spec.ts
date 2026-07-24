import { test, expect, _electron as electron } from '@playwright/test';

test('adds, edits, and removes a workspace-local pane description', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await expect(win.locator('.welcome')).toBeVisible();

  await win.evaluate(() => {
    const store = (window as unknown as {
      __store: { setState: (patch: unknown) => void };
    }).__store;
    store.setState({
      workspaces: [{
        id: 'w1', name: 'Workspace 1', cwd: '/tmp',
        layout: { type: 'pane', id: 'label-pane' }
      }],
      activeWorkspaceId: 'w1'
    });
  });

  const pane = win.locator('.pane');
  await expect(pane).toBeVisible();
  await expect(pane.locator('.pane-title:visible')).not.toHaveText('');

  await pane.locator('.pane-label-btn').click();
  const input = pane.locator('.pane-label-input');
  await expect(input).toBeFocused();
  await input.fill('  API monitoring  ');
  await input.press('Enter');

  await expect(pane.locator('.pane-label')).toBeVisible();
  await expect(pane.locator('.pane-label')).toHaveText('API monitoring');
  await expect(pane.locator('.pane-label-btn')).toHaveClass(/active/);
  await expect(pane.locator('.pane-title:visible')).not.toHaveText('');

  await pane.locator('.pane-label-btn').click();
  await input.fill('   ');
  await input.press('Enter');

  await expect(pane.locator('.pane-label')).toHaveCount(0);
  await expect(pane.locator('.pane-label-btn')).not.toHaveClass(/active/);

  await app.close();
});
