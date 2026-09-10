import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('a former task workspace stays usable and preserves its Markdown and gitignore', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-legacy-board-'));
  const profile = join(dir, 'profile');
  mkdirSync(profile);
  mkdirSync(join(dir, '.dmworkspace'));
  const tasksFile = join(dir, '.dmworkspace', 'TASKS.md');
  const originalTasks = '## Todo\n- [ ] Keep my existing notes `echo example`\n';
  const originalIgnore = 'node_modules/\n.dmworkspace/\n';
  writeFileSync(tasksFile, originalTasks);
  writeFileSync(join(dir, '.gitignore'), originalIgnore);
  writeFileSync(join(profile, 'state.json'), JSON.stringify({
    version: 1, activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Legacy project', cwd: dir, layout: null, tasksEnabled: true }],
    settings: { locale: 'en', themeId: 'default', terminalOpacity: 0.95 }
  }));
  const env = { ...process.env, DMWS_USERDATA: profile, DMWS_DISABLE_WEBGL: '1' } as Record<string, string>;
  delete env.DMWS_E2E;
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env });
  try {
    const win = await app.firstWindow();
    await expect(win.getByText('Legacy project').first()).toBeVisible();
    await expect(win.locator('.welcome')).toBeVisible();
    await expect(win.getByRole('checkbox')).toHaveCount(0);
    await expect(win.getByRole('tab', { name: 'Tasks', exact: true })).toHaveCount(0);
    await win.locator('.ws-item').first().dblclick();
    const dialog = win.locator('.ws-edit-modal');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await win.getByRole('button', { name: '1 Pane', exact: true }).click();
    await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  } finally {
    await app.close();
    try {
      expect(readFileSync(tasksFile, 'utf8')).toBe(originalTasks);
      expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe(originalIgnore);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
