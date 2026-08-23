import { test, expect, _electron as electron, type Page, type Locator } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { waitForShellPrompt } from './wait-helpers';

// Grouping is a drag onto the MIDDLE of another register — the outer thirds keep
// meaning "reorder before/after". These specs drive the real HTML5 drag, because
// that middle zone only exists in browser coordinates: resolveTabDropIntent is
// unit-tested, but nothing below vitest proves the component hands it the right
// rectangle, or that a group survives a restart.

interface SeedWorkspace { id: string; name: string; cwd: string; layout: null }

async function seedWorkspaces(win: Page, workspaces: SeedWorkspace[]): Promise<void> {
  await win.evaluate((list) => {
    const store = (window as unknown as {
      __store: { setState: (patch: unknown) => void };
    }).__store;
    store.setState({ workspaces: list, activeWorkspaceId: list[0].id, workspaceGroups: [] });
  }, workspaces);
}

const THREE: SeedWorkspace[] = [
  { id: 'w1', name: 'One', cwd: '/tmp', layout: null },
  { id: 'w2', name: 'Two', cwd: '/tmp', layout: null },
  { id: 'w3', name: 'Three', cwd: '/tmp', layout: null }
];

/** Drop `source` on the middle third of `target` — the zone that means "group". */
async function dropInto(source: Locator, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  expect(box).not.toBeNull();
  await source.dragTo(target, { targetPosition: { x: box!.width / 2, y: box!.height / 2 } });
}

test('groups two registers by dropping one onto the middle of the other, and lets one leave again', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await expect(win.locator('.sidebar')).toBeVisible();
  await seedWorkspaces(win, THREE);

  const items = win.locator('.ws-item');
  await expect(items).toHaveCount(3);
  await expect(win.locator('.ws-group')).toHaveCount(0);

  await dropInto(items.nth(2), items.nth(0));

  // The target keeps its place and the dragged register lands behind it.
  await expect(win.locator('.ws-group')).toHaveCount(1);
  await expect(win.locator('.ws-group .ws-item .name')).toHaveText(['One', 'Three']);
  // "Two" stayed loose.
  await expect(items).toHaveCount(3);

  // A new group is created unnamed and goes straight into its inline editor —
  // naming it is only ever going to happen now.
  const input = win.locator('.ws-group-input');
  await expect(input).toBeVisible();
  await input.fill('Alpha');
  await input.press('Enter');
  await expect(win.locator('.ws-group-name')).toHaveText('Alpha');

  // Dropping on the FIRST member's leading third is the outer edge of the run,
  // which is how a member is dragged back out.
  const members = win.locator('.ws-group .ws-item');
  const firstBox = await members.nth(0).boundingBox();
  expect(firstBox).not.toBeNull();
  await members.nth(1).dragTo(members.nth(0), { targetPosition: { x: 20, y: 2 } });

  await expect(win.locator('.ws-group .ws-item .name')).toHaveText(['One']);
  await expect(items).toHaveCount(3);

  await app.close();
});

test('collapsing a group hides its registers but keeps their terminals running', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    // DOM renderer so terminal text is readable from .xterm-rows.
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  await waitForShellPrompt(win);
  await win.locator('.pane .xterm-screen').click();
  await win.keyboard.type('echo GROUP_PROBE_4242');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('GROUP_PROBE_4242');

  // A second register to group the first one with.
  await win.locator('.add-ws').first().click();
  const items = win.locator('.ws-item');
  await expect(items).toHaveCount(2);

  await dropInto(items.nth(1), items.nth(0));
  await expect(win.locator('.ws-group .ws-item')).toHaveCount(2);
  await win.locator('.ws-group-input').press('Escape');

  // The workspace holding the terminal must be the active one, so that hiding it
  // from the navigation is what the assertion below actually tests.
  await win.locator('.ws-group .ws-item').first().click();
  await expect(win.locator('.ws-item.active .name')).toHaveText('Workspace 1');

  await win.locator('.ws-group-chip').click();

  // Registers gone from the navigation…
  await expect(win.locator('.ws-group .ws-item')).toHaveCount(0);
  // …but the workspaces themselves untouched: WorkspaceView keeps every one of
  // them mounted, so the terminal is still there with its output. Unmounting
  // here would take the shell with it.
  await expect(win.locator('.xterm-rows').first()).toContainText('GROUP_PROBE_4242');
  const count = await win.evaluate(() => (window as unknown as {
    __store: { getState: () => { workspaces: unknown[] } };
  }).__store.getState().workspaces.length);
  expect(count).toBe(2);

  // A collapsed group holding the active workspace has to say so — otherwise
  // activeWorkspaceId is valid but invisible.
  await expect(win.locator('.ws-group-chip.active')).toHaveCount(1);
  await expect(win.locator('.ws-group-chip.active .ws-group-count')).toHaveText('Workspace 1');

  await win.locator('.ws-group-chip').click();
  await expect(win.locator('.ws-group .ws-item')).toHaveCount(2);

  // Regression: dissolving used to sit on the chip as a hover button, i.e. right
  // where the pointer already is when you click to collapse. Clicking the chip
  // must never destroy the group — it belongs in the context menu.
  await win.locator('.ws-group-chip').click();
  await win.locator('.ws-group-chip').click();
  await expect(win.locator('.ws-group')).toHaveCount(1);
  await expect(win.locator('.ws-group .ws-item')).toHaveCount(2);

  await app.close();
});

test('groups registers in the top tabs the same way', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await expect(win.locator('.sidebar')).toBeVisible();
  await seedWorkspaces(win, THREE);
  await win.evaluate(() => {
    const store = (window as unknown as {
      __store: { getState: () => { updateSettings: (patch: unknown) => void } };
    }).__store;
    store.getState().updateSettings({ workspaceNavigationPlacement: 'top' });
  });

  const tabs = win.locator('.workspace-tab');
  await expect(tabs).toHaveCount(3);
  await dropInto(tabs.nth(2), tabs.nth(0));

  await expect(win.locator('.ws-group')).toHaveCount(1);
  await expect(win.locator('.ws-group .workspace-tab .name')).toHaveText(['One', 'Three']);

  await app.close();
});

test('a group survives a restart', async () => {
  const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-e2e-groups-'));
  const launchEnv = (): Record<string, string> =>
    ({ ...process.env, DMWS_USERDATA: USERDATA, DMWS_E2E: '1' }) as Record<string, string>;

  const app1 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win1 = await app1.firstWindow();
  await expect(win1.locator('.sidebar')).toBeVisible();
  await seedWorkspaces(win1, THREE);

  const items = win1.locator('.ws-item');
  await expect(items).toHaveCount(3);
  await dropInto(items.nth(2), items.nth(0));
  await win1.locator('.ws-group-input').fill('Beta');
  await win1.locator('.ws-group-input').press('Enter');
  await expect(win1.locator('.ws-group-name')).toHaveText('Beta');

  // Closing before the write lands would leave launch 2 nothing to restore. The
  // store persists through an IPC round trip, so poll the file rather than
  // guessing at a delay.
  const stateFile = join(USERDATA, 'state.json');
  const deadline = Date.now() + 10000;
  for (;;) {
    let written = false;
    try { written = readFileSync(stateFile, 'utf8').includes('"Beta"'); } catch { /* not written yet */ }
    if (written) break;
    if (Date.now() > deadline) throw new Error('timed out waiting for the group to reach state.json');
    await new Promise((r) => setTimeout(r, 100));
  }
  await app1.close();

  const app2 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win2 = await app2.firstWindow();
  await expect(win2.locator('.ws-group')).toHaveCount(1);
  await expect(win2.locator('.ws-group-name')).toHaveText('Beta');
  await expect(win2.locator('.ws-group .ws-item .name')).toHaveText(['One', 'Three']);

  await app2.close();
});
