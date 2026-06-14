import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

test('file browser: set root, create a file, edit, save, verify on disk', async () => {
  // A disposable workspace folder with one subdir to prove navigation works.
  const work = mkdtempSync(join(tmpdir(), 'dmws-e2e-fb-'));
  mkdirSync(join(work, 'sub'));

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  try {
    const win = await app.firstWindow();

    // Open a workspace so the app is past the welcome screen.
    await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();
    await win.getByText('4 (2×2)').click();
    await expect(win.locator('.pane')).toHaveCount(4);

    // Open the file browser and point it at our temp folder. The folder dialog
    // can't be scripted portably, so drive the store via the e2e hook.
    await win.evaluate((root) => {
      const store = (window as unknown as { __store: { getState(): { openFiles(): void; setBrowseRoot(p: string): void } } }).__store;
      store.getState().openFiles();
      store.getState().setBrowseRoot(root);
    }, work);

    await expect(win.locator('.preview-panel')).toBeVisible();
    await expect(win.locator('.ftree-row', { hasText: 'sub' })).toBeVisible();

    // Create a new file in the current folder.
    await win.locator('.icon-btn[aria-label="Neue Datei"]').click();
    await win.locator('.files-newinput').fill('notes.txt');
    await win.locator('.files-newinput').press('Enter');

    // The editor opens for the new file; type content and save via the BUTTON.
    await expect(win.locator('.feditor-name')).toContainText('notes.txt');
    await win.locator('.feditor-textarea').fill('hello from e2e');
    await expect(win.locator('.feditor-save')).toBeEnabled();
    await win.locator('.feditor-save').click();
    await expect(win.locator('.feditor-save')).toBeDisabled(); // not dirty after save

    // The file really exists on disk with the typed content.
    await expect.poll(() => readFileSync(join(work, 'notes.txt'), 'utf8')).toBe('hello from e2e');
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});
