import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

// Changing a workspace's base folder restarts its terminals. Two regressions
// live on this path:
//  - The restart confirmation used window.confirm(). Electron's native JS
//    dialogs leave the renderer with a dead caret and a swallowed Space key
//    until the window loses OS focus (electron/electron#41603) — the app must
//    only ever show its in-app ConfirmDialog here.
//  - After the restart nothing focused the remounted panes (focusedPaneId was
//    null), so keystrokes fell into <body> until a click.
// This test drives the full edit → change folder → confirm → done flow and
// then types — including spaces — WITHOUT clicking into the terminal first.
test('folder change restarts panes, keeps keyboard focus and a typing space', async () => {
  const pickDir = mkdtempSync(join(tmpdir(), 'dmws-pickdir-'));
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    // DOM renderer so terminal text is readable from .xterm-rows.
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1', DMWS_E2E_PICK_DIR: pickDir }
  });
  const win = await app.firstWindow();

  // One running pane, so the folder change has terminals to restart.
  await win.getByText(/^(1 Pane|1 Bereich)$/).click();
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();
  await win.waitForTimeout(1500); // shell prompt

  // Double-click the workspace row opens the editor.
  await win.locator('.ws-item').first().dblclick();
  await expect(win.locator('.ws-edit-modal')).toBeVisible();

  // "Change" resolves the stubbed directory picker, which must surface the
  // IN-APP restart confirmation (never a native window.confirm — that would
  // hang this test on an undismissable dialog).
  await win.locator('.ws-edit-folder-btn').click();
  const confirm = win.getByRole('alertdialog', { name: /(Restart workspace\?|Workspace neu starten\?)/ });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: /^(Restart|Neu starten)$/ }).click();
  await expect(confirm).toHaveCount(0);

  // The picked folder is shown in the editor before committing.
  await expect(win.locator('.ws-edit-folder-path')).toContainText(basename(pickDir));

  await win.getByRole('button', { name: /^(Done|Fertig)$/ }).click();
  await expect(win.locator('.ws-edit-modal')).toHaveCount(0);

  // The pane restarted in the picked folder…
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();
  await win.waitForTimeout(2000); // fresh shell prompt in the new cwd
  await expect(win.locator('.xterm-rows').first()).toContainText(basename(pickDir));

  // …and keyboard focus landed in the restarted terminal by itself.
  const activeClass = await win.evaluate(() => document.activeElement?.className ?? '');
  expect(activeClass).toContain('xterm-helper-textarea');

  // Typing works immediately — no click, no Alt-Tab — including the Space key.
  await win.keyboard.type('echo FOLDER_PROBE A B');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('FOLDER_PROBE A B');

  await app.close();
});
