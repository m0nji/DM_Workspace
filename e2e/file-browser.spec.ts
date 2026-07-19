import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

test('file browser: set root, create a file, edit, save, verify on disk', async () => {
  // A disposable workspace folder with one subdir and a markdown file.
  const work = mkdtempSync(join(tmpdir(), 'dmws-e2e-fb-'));
  mkdirSync(join(work, 'sub'));
  writeFileSync(join(work, 'guide.md'), '# Guide\n\nHello from markdown', 'utf8');

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
    await win.locator('.icon-btn[aria-label="New file"]').click();
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

    // Right-click the markdown file → context menu offers Preview + Edit.
    await win.locator('.preview-tab-btn', { hasText: 'Files' }).click();
    await win.locator('.ftree-row', { hasText: 'guide.md' }).click({ button: 'right' });
    await expect(win.locator('.context-menu-item', { hasText: 'Preview' })).toBeVisible();
    await expect(win.locator('.context-menu-item', { hasText: 'Edit' })).toBeVisible();

    // Choosing Preview renders the markdown read-only in the preview tab.
    await win.locator('.context-menu-item', { hasText: 'Preview' }).click();
    await expect(win.locator('.markdown-body')).toContainText('Hello from markdown');
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});

test('file browser: html files offer a preview that renders in the webview', async () => {
  const work = mkdtempSync(join(tmpdir(), 'dmws-e2e-html-'));
  writeFileSync(join(work, 'report.html'), '<!doctype html><title>t</title><h1>Hello from html</h1>', 'utf8');

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  try {
    const win = await app.firstWindow();
    await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();
    await win.getByText('4 (2×2)').click();
    await expect(win.locator('.pane')).toHaveCount(4);

    await win.evaluate((root) => {
      const store = (window as unknown as { __store: { getState(): { openFiles(): void; setBrowseRoot(p: string): void } } }).__store;
      store.getState().openFiles();
      store.getState().setBrowseRoot(root);
    }, work);

    // The Preview entry must now appear for .html, not just markdown.
    await win.locator('.ftree-row', { hasText: 'report.html' }).click({ button: 'right' });
    await expect(win.locator('.context-menu-item', { hasText: 'Preview' })).toBeVisible();
    await win.locator('.context-menu-item', { hasText: 'Preview' }).click();

    // It routes to the sandboxed webview (not the markdown renderer) and points
    // at the file we wrote.
    const webview = win.locator('.preview-webview');
    await expect(webview).toBeVisible();
    await expect.poll(() => webview.getAttribute('src')).toContain('report.html');
    await expect.poll(() => webview.getAttribute('src')).toMatch(/^file:\/\//);
    await expect(win.locator('.markdown-body')).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});

test('file browser: reopening jumps to the focused pane live cwd', async () => {
  const work = mkdtempSync(join(tmpdir(), 'dmws-e2e-cwd-'));
  mkdirSync(join(work, 'elsewhere'));
  mkdirSync(join(work, 'pane-dir'));

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  try {
    const win = await app.firstWindow();
    await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();
    await win.getByText('4 (2×2)').click();
    await expect(win.locator('.pane')).toHaveCount(4);

    type FbStore = {
      getState(): {
        openFiles(): void;
        setBrowseRoot(p: string): void;
        togglePreview(): void;
        focusedPaneId: string | null;
        paneCwd: Record<string, string>;
        workspaces: Array<{ id: string; cwd: string }>;
        activeWorkspaceId: string | null;
        previewPanel: { browseRoot: string | null; open: boolean };
      };
    };
    // The real shell reports its own cwd over OSC, so assert against that live
    // value rather than planting one (which the shell would overwrite).
    await win.evaluate(() => (window as unknown as { __store: FbStore }).__store.getState().openFiles());
    await expect(win.locator('.preview-panel')).toBeVisible();

    await win.evaluate((dir) => {
      (window as unknown as { __store: FbStore }).__store.getState().setBrowseRoot(dir);
    }, join(work, 'elsewhere'));

    // Navigating away must stick while the panel stays open.
    let root = await win.evaluate(() => (window as unknown as { __store: FbStore }).__store.getState().previewPanel.browseRoot);
    expect(root).toBe(join(work, 'elsewhere'));

    // Close and reopen — it must land back on the focused pane's folder.
    const expected = await win.evaluate(() => {
      const s = (window as unknown as { __store: FbStore }).__store.getState();
      const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
      return (s.focusedPaneId ? s.paneCwd[s.focusedPaneId] : undefined) ?? ws?.cwd ?? '~';
    });
    await win.evaluate(() => {
      const s = (window as unknown as { __store: FbStore }).__store.getState();
      s.togglePreview(); // close
      s.togglePreview(); // open
    });
    root = await win.evaluate(() => (window as unknown as { __store: FbStore }).__store.getState().previewPanel.browseRoot);
    expect(root).toBe(expected);
    expect(root).not.toBe(join(work, 'elsewhere')); // the stale root really was dropped
  } finally {
    await app.close();
    rmSync(work, { recursive: true, force: true });
  }
});
