import { test, expect, _electron as electron } from '@playwright/test';

test('switches workspace navigation to top tabs from appearance settings', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
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

// Switching the placement swaps the app shell around the workspace view. That
// must not tear the view out of the React tree: a remount unmounts every
// PanePortal, and its cleanup releases the pane's stable container (see
// pane-host.ts) — which the freshly mounted slot had already re-adopted. The
// pane's terminal then lives in a detached div: splitters still paint, the
// panes are blank, and no further toggle brings them back.
test('keeps live terminals when the workspace navigation placement changes', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    // DOM renderer so terminal text is readable from .xterm-rows.
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  await win.waitForTimeout(1500); // shell prompt

  await win.locator('.pane .xterm-screen').click();
  await win.keyboard.type('echo PLACEMENT_PROBE_4242');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('PLACEMENT_PROBE_4242');

  // Tag the live terminal's DOM. A remount creates a fresh xterm host and the
  // tag disappears; a detached host stops matching a document query at all.
  await win.evaluate(() => {
    document.querySelector('.pane .xterm-host')!.setAttribute('data-probe', 'alive');
  });

  const setPlacement = async (label: string): Promise<void> => {
    await win.getByTitle('Settings').click();
    await expect(win.getByText('Workspace navigation')).toBeVisible();
    await win.getByRole('button', { name: label }).click();
    await win.locator('.modal-close').click();
  };

  await setPlacement('Top tabs');
  await expect(win.locator('.workspace-tabs')).toBeVisible();
  await expect(win.locator('.pane .xterm-host[data-probe="alive"]')).toHaveCount(1);
  await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  await expect(win.locator('.xterm-rows').first()).toContainText('PLACEMENT_PROBE_4242');

  // …and the same terminal survives the way back.
  await setPlacement('Left sidebar');
  await expect(win.locator('.sidebar')).toBeVisible();
  await expect(win.locator('.pane .xterm-host[data-probe="alive"]')).toHaveCount(1);
  await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  await expect(win.locator('.xterm-rows').first()).toContainText('PLACEMENT_PROBE_4242');

  // The terminal is still attached to the live PTY, not just visible.
  await win.locator('.pane .xterm-screen').click();
  await win.keyboard.type('echo AFTER_TOGGLE_7171');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('AFTER_TOGGLE_7171');

  await app.close();
});

test('reorders workspaces by drag and drop in the sidebar and top tabs', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
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
