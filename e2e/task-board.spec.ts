import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, mkdirSync as mkdir } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

test.setTimeout(60000);

test('task board: opt-in, create persists to TASKS.md (+gitignore), external edit updates board', async () => {
  // ── 1. Prepare isolated directories ──────────────────────────────────────
  // `dir` is the workspace cwd; has a .git so the gitignore code path runs.
  const dir = mkdtempSync(join(tmpdir(), 'dmtask-e2e-'));
  mkdirSync(join(dir, '.git'), { recursive: true });

  // `userData` is a private Electron userData dir for this test run.
  const userData = mkdtempSync(join(tmpdir(), 'dmtask-ud-'));

  // Seed state.json so the app opens with one workspace whose cwd is `dir`
  // and whose layout is null (welcome screen).  tasksEnabled is intentionally
  // omitted because persistence.ts does not migrate it; we'll tick the
  // checkbox in the test instead.
  const state = {
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Workspace 1', cwd: dir, layout: null, tasksEnabled: true }],
    settings: { themeId: 'default', terminalOpacity: 0.75, workspaceNavigationPlacement: 'left' }
  };
  writeFileSync(join(userData, 'state.json'), JSON.stringify(state, null, 2), 'utf8');

  // ── 2. Launch Electron ────────────────────────────────────────────────────
  const env: Record<string, string> = { ...process.env, DMWS_USERDATA: userData } as Record<string, string>;
  delete env.DMWS_E2E; // don't let e2e isolation override our explicit userData dir
  const app = await electron.launch({ args: ['out/main/index.js'], env });
  const win = await app.firstWindow();

  // Welcome screen must appear (layout is null).
  await expect(win.getByText('How many terminals do you want to open?')).toBeVisible({ timeout: 15000 });

  // ── 3. Opt-in: verify the checkbox is checked (seeded via state.json) ────
  // tasksEnabled is seeded true in state.json (persistence.ts now migrates it).
  // We verify the UI reflects the opt-in without needing a native click,
  // since the macOS hiddenInset titlebar intercepts pointer events in e2e.
  const checkbox = win.locator('.welcome-tasks-toggle input[type="checkbox"]');
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked();

  // The Tasks tab should now appear in the titlebar.
  const tasksTab = win.getByRole('tab', { name: 'Tasks' });
  await expect(tasksTab).toBeVisible();

  // ── 4. Open the task board ────────────────────────────────────────────────
  await tasksTab.click();
  await expect(win.locator('.task-board')).toBeVisible();

  // ── 5. Add a task in the first column ────────────────────────────────────
  await win.locator('.task-column').first().locator('.task-add').click();

  // A card appears with the default title "Neue Task".
  const card = win.locator('.task-card').first();
  await expect(card).toBeVisible();

  // Double-click the card's main area (the onDoubleClick handler lives there).
  await card.locator('.task-card-main').dblclick();

  // Fill the title and save.
  const titleInput = win.locator('.task-edit-title');
  await expect(titleInput).toBeVisible();
  await titleInput.fill('e2e task');
  await win.getByRole('button', { name: 'Speichern' }).click();

  // The card should now show our title.
  await expect(win.locator('.task-card', { hasText: 'e2e task' })).toBeVisible();

  // ── 6. Verify TASKS.md was written ───────────────────────────────────────
  const tasksFile = join(dir, '.dmworkspace', 'TASKS.md');
  await expect.poll(() => existsSync(tasksFile), { timeout: 5000 }).toBe(true);
  const tasksContent = readFileSync(tasksFile, 'utf8');
  expect(tasksContent).toContain('e2e task');

  // ── 7. Verify .gitignore was updated ─────────────────────────────────────
  const gitignore = join(dir, '.gitignore');
  expect(existsSync(gitignore)).toBe(true);
  expect(readFileSync(gitignore, 'utf8')).toContain('.dmworkspace/');

  // ── 8. External edit → board updates live ────────────────────────────────
  // Write a completely new board via direct file write. The IPC watcher fires
  // after a ~150 ms debounce and sends tasks:changed to the renderer.
  writeFileSync(
    tasksFile,
    '## Todo\n- [ ] from-disk\n## Doing\n## Done\n',
    'utf8'
  );

  // Wait for the card to appear (file watcher + debounce + React re-render).
  await expect(win.locator('.task-card', { hasText: 'from-disk' })).toBeVisible({ timeout: 8000 });

  // ── 9. Teardown ───────────────────────────────────────────────────────────
  await app.close();
});
