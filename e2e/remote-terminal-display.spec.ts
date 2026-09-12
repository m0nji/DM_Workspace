import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const initialScreen of ['Worked for 4m 44s', 'OpenAI Codex (v0.154.0)'] as const) {
test(`remote observer and idle animation: ${initialScreen}`, async () => {
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: {
    ...process.env, DMWS_USERDATA: mkdtempSync(join(tmpdir(), 'dmws-remote-display-')),
    DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1'
  } });
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.root');
    await win.evaluate(() => {
      const store = (window as any).__store;
      store.setState({
        workspaces: [{ id: 'remote', name: 'Remote', cwd: '/workspace', kind: 'remote',
          remote: { serverId: 'srv', scope: 'project', projectId: 'project' },
          layout: { type: 'pane', id: 'r:srv:project:p1' } }],
        activeWorkspaceId: 'remote', focusedPaneId: 'r:srv:project:p1',
        remote: { 'srv:project': { status: 'connected', clientId: 'desktop', role: 'owner',
          presence: [], deniedPaneId: null, lastError: null, serverFeatures: ['tasks'],
          panes: [{ paneId: 'p1', title: 'Terminal', cols: 100, rows: 35, driver: 'web',
            driverQueue: [], queueDeadline: null, running: true }] } },
        settings: { ...store.getState().settings, servers: [{ id: 'srv', name: 'Server', baseUrl: 'https://example.invalid' }] }
      });
    });
    const size = () => win.evaluate(() => (window as any).__termSize?.get('r:srv:project:p1')?.());
    await expect.poll(size).toEqual({ cols: 100, rows: 35 });
    await win.locator('.pane-agent-status').click();
    const dialog = win.getByRole('alertdialog');
    await expect(dialog.getByRole('button')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeFocused();
    await win.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(win.locator('button[title="Scheduled Tasks"]')).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 600));
    await expect.poll(size).toEqual({ cols: 100, rows: 35 });
    const updatePane = async (patch: object) => win.evaluate(patch => {
      const store = (window as any).__store;
      const remote = store.getState().remote;
      const conn = remote['srv:project'];
      store.setState({ remote: { ...remote, 'srv:project': { ...conn, panes: [{ ...conn.panes[0], ...patch }] } } });
    }, patch);
    await updatePane({ cols: 90, rows: 28 });
    await expect.poll(size).toEqual({ cols: 90, rows: 28 });
    // Cursor-addressed repaint must replace the bottom status line in-place.
    await win.evaluate(() => {
      (window as any).__termWrite.get('r:srv:project:p1')('\x1b[2J\x1b[28;1HOLD STATUS\x1b[28;1H\x1b[2KNEW STATUS');
    });
    await expect.poll(() => win.evaluate(() => (window as any).__bufferText.get('r:srv:project:p1')())).toContain('NEW STATUS');
    expect(await win.evaluate(() => (window as any).__bufferText.get('r:srv:project:p1')())).not.toContain('OLD STATUS');
    const emit = async (data: string) => app.evaluate(({ BrowserWindow }, data) => {
      BrowserWindow.getAllWindows()[0].webContents.send('pty:data', { paneId: 'r:srv:project:p1', data });
    }, data);
    await emit(`\x1b[2J\x1b[1;1H${initialScreen}\r\n\r\n› Ask Codex to do anything\r\ngpt-6-astra medium · Context 100% left`);
    const status = () => win.evaluate(() => (window as any).__store.getState().paneStatus['r:srv:project:p1']);
    await expect.poll(status).toBe('busy');
    // Keep repainting more often than the 2-second silence threshold.
    // Raw-output activity would never reach done during this sequence.
    for (let frame = 0; frame < 16; frame++) {
      // Das Sternenfeld trifft auch die Spalte zwischen Prompt-Zeichen und
      // Platzhalter — dort darf die Normalisierung den Text nicht verschieben.
      const gap = frame % 2 ? '\u2801' : ' ';
      await emit(`\x1b[2;1H\x1b[2K${' '.repeat(frame % 8)}·  \u2804.\x1b[3;1H\x1b[2K›${gap}Ask Codex to do anything${' '.repeat(frame % 5)}\u2808`);
      await new Promise(resolve => setTimeout(resolve, 200));
      if (frame === 12) {
        expect(await status()).toBe('done');
        await expect(win.locator('.status-dot.done')).toBeVisible();
      }
    }
    expect(await status()).toBe('done');
    await emit('\x1b[1;1HNew answer is arriving');
    await expect.poll(status).toBe('busy');
    await updatePane({ driver: 'desktop' });
    await expect.poll(size).not.toEqual({ cols: 90, rows: 28 });
    await expect(win.locator('.remote-observer')).toHaveCount(0);
    await updatePane({ driver: 'web', cols: 110, rows: 40 });
    await expect.poll(size).toEqual({ cols: 110, rows: 40 });
  } finally { await app.close(); }
});
}
