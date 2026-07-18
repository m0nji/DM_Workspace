import { test, expect, _electron as electron } from '@playwright/test';

test('switches workspace navigation to top tabs from appearance settings', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByTitle('Settings').click();
  await expect(win.getByText('Workspace navigation')).toBeVisible();
  await win.getByRole('button', { name: 'Top tabs' }).click();
  await win.locator('.modal-close').click();

  await expect(win.locator('.workspace-tabs')).toBeVisible();
  await expect(win.locator('.sidebar')).toHaveCount(0);
  await expect(win.locator('.workspace-tab.active').getByText('Workspace 1')).toBeVisible();

  // Regression: top-tab edit/close actions used to be absolutely positioned
  // over the end of the workspace name. They must occupy their own flex space
  // on hover, with no tab-size jump and no overlap on macOS or Windows.
  const tab = win.locator('.workspace-tab.active');
  const before = await tab.boundingBox();
  await tab.hover();
  const name = await tab.locator('.name').boundingBox();
  const actions = await tab.locator('.ws-actions').boundingBox();
  const after = await tab.boundingBox();
  expect(before).not.toBeNull();
  expect(name).not.toBeNull();
  expect(actions).not.toBeNull();
  expect(after).not.toBeNull();
  expect(after!.width).toBeCloseTo(before!.width, 1);
  expect(actions!.x).toBeGreaterThanOrEqual(name!.x + name!.width - 0.5);

  await app.close();
});

test('reorders workspaces by drag and drop in the sidebar and top tabs', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await expect(win.locator('.sidebar')).toBeVisible();

  await win.evaluate(() => {
    const store = (window as unknown as {
      __store: {
        setState: (patch: unknown) => void;
        getState: () => { settings: unknown; updateSettings: (patch: unknown) => void };
      };
    }).__store;
    store.setState({
      workspaces: [
        { id: 'w1', name: 'One', cwd: '/tmp', layout: null },
        { id: 'w2', name: 'Two', cwd: '/tmp', layout: null },
        { id: 'w3', name: 'Three', cwd: '/tmp', layout: null }
      ],
      activeWorkspaceId: 'w1'
    });
  });

  const sidebarItems = win.locator('.ws-item');
  await expect(sidebarItems).toHaveCount(3);
  const firstSidebarBox = await sidebarItems.nth(0).boundingBox();
  expect(firstSidebarBox).not.toBeNull();
  await sidebarItems.nth(2).dragTo(sidebarItems.nth(0), {
    targetPosition: { x: 20, y: 2 }
  });
  await expect(sidebarItems.locator('.name')).toHaveText(['Three', 'One', 'Two']);

  await win.evaluate(() => {
    const store = (window as unknown as {
      __store: { getState: () => { updateSettings: (patch: unknown) => void } };
    }).__store;
    store.getState().updateSettings({ workspaceNavigationPlacement: 'top' });
  });

  const tabs = win.locator('.workspace-tab');
  await expect(tabs).toHaveCount(3);
  const lastTabBox = await tabs.nth(2).boundingBox();
  expect(lastTabBox).not.toBeNull();
  await tabs.nth(0).dragTo(tabs.nth(2), {
    targetPosition: { x: lastTabBox!.width - 2, y: lastTabBox!.height / 2 }
  });
  await expect(tabs.locator('.name')).toHaveText(['One', 'Two', 'Three']);

  await app.close();
});
