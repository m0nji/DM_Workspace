import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Real shell, PTY, hook bridge and UI; stand-in CLIs avoid paid model requests.
for (const provider of ['claude', 'codex', 'opencode'] as const) {
  test(`${provider} starts by button in its own pane and reports status`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-start-'));
    const project = join(dir, "project with 'quotes'");
    mkdirSync(project);
    const testShell = join(dir, 'sh');
    if (process.platform !== 'win32') writeFileSync(testShell, `#!/bin/sh\nexport PATH='${dir}:/usr/bin:/bin'\nexec /bin/bash --noprofile --norc "$@"\n`, { mode: 0o700 });
    if (process.platform === 'win32') copyFileSync(process.execPath, join(dir, 'node.exe'));
    else symlinkSync(process.execPath, join(dir, 'node'));
    const fixture = join(dir, process.platform === 'win32' ? 'agent-fixture.cjs' : provider);
    writeFileSync(fixture, `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
(async () => {
  if (${JSON.stringify(provider)} === 'claude') {
    const settings = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--settings') + 1], 'utf8'));
    const hook = settings.hooks.UserPromptSubmit[0].hooks[0];
    const res = await fetch(hook.url, { method: 'POST', headers: { ...hook.headers, 'Content-Type': 'application/json', 'X-DMWS-Terminal': process.env.DMWS_AGENT_NONCE }, body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'direct-start' }) });
    if (!res.ok) process.exit(7);
  } else if (${JSON.stringify(provider)} === 'codex') {
    const config = process.argv[process.argv.indexOf('-c') + 1];
    console.log('CODEX_ARGS=' + JSON.stringify(process.argv.slice(2)));
    const encoded = config.match(/Buffer.from\\('([^']+)'/)[1];
    const path = Buffer.from(encoded, 'base64').toString();
    const child = cp.spawnSync(process.execPath, [path], { env: process.env, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'direct-start', turn_id: 'turn-1' }) });
    if (child.status !== 0) process.exit(8);
  }
  console.log('AGENT_STARTED_IN=' + process.cwd());
  setInterval(() => {}, 1000);
})().catch(e => { console.error(e); process.exit(9); });
`, { mode: 0o700 });
    if (process.platform === 'win32') writeFileSync(join(dir, `${provider}.cmd`), `@"${process.execPath}" "${fixture}" %*\r\n`);
    const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env,
      ...(process.platform === 'win32' ? { PATH: `${dir};${process.env.PATH ?? ''}` } : { SHELL: testShell, PATH: `${dir}:/usr/bin:/bin` }), DMWS_E2E: '1' } });
    try {
      const win = await app.firstWindow();
      await expect(win.locator('.welcome')).toBeVisible();
      await win.evaluate(project => {
        (window as unknown as { __store: { setState(s: unknown): void } }).__store.setState({
          workspaces: [{ id: 'launch', name: 'Launch test', cwd: project, layout: { type: 'pane', id: 'original' } }],
          activeWorkspaceId: 'launch', paneCwd: { original: project }
        });
      }, project);
      const original = win.locator('.pane').first();
      await expect(original.locator('.xterm')).toBeVisible();
      await expect.poll(() => win.evaluate(provider => window.api.checkAgentStart('original', provider), provider)).toBe('ready');
      // Preserve even an unfinished input line in the source terminal.
      await win.evaluate(() => window.api.input({ paneId: 'original', data: 'unfinished-input' }));
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      const dialog = win.getByRole('alertdialog');
      await dialog.getByRole('combobox').selectOption(provider);
      await expect(dialog).toContainText(project);
      await expect(dialog.locator('code')).toHaveCount(0);
      await win.screenshot({ path: join(tmpdir(), `dmws-direct-start-${provider}.png`) });
      await dialog.getByRole('button', { name: 'Start agent', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(win.locator('.pane-agent-status')).toHaveCount(2);
      const buffers = () => win.evaluate(() => Object.fromEntries([...((window as unknown as { __bufferText: Map<string, () => string> }).__bufferText)].map(([id, read]) => [id, read()])));
      await expect.poll(async () => Object.entries(await buffers()).filter(([id]) => id !== 'original').map(([, text]) => text).join('\n').replace(/\r?\n/g, '')).toContain(`AGENT_STARTED_IN=${realpathSync.native(project)}`);
      await expect(win.locator('.pane-agent-status').filter({ hasText: `${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'OpenCode'} · ${provider === 'opencode' ? 'Unknown' : 'Working'}` })).toHaveCount(1);
      expect((await buffers()).original).not.toContain('AGENT_STARTED_IN=');
      expect((await buffers()).original).toContain('unfinished-input');
      await expect(win.locator('.pane').nth(1).getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
      await win.screenshot({ path: join(tmpdir(), `dmws-direct-start-${provider}-running.png`) });
      console.log(provider + ': assertions passed');
    } finally { console.log(provider + ': closing app'); await app.close(); console.log(provider + ': closed app'); rmSync(dir, { recursive: true, force: true }); }
  });
}

test('missing CLI stays in the dialog without opening a pane', async () => {
  test.skip(process.platform === 'win32', 'POSIX shell fixture');
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-missing-'));
  const testShell = join(dir, 'sh');
  writeFileSync(testShell, '#!/bin/sh\nexport PATH=/usr/bin:/bin\nexec /bin/bash --noprofile --norc "$@"\n', { mode: 0o700 });
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, SHELL: testShell, PATH: '/usr/bin:/bin', DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => (window as unknown as { __store: { setState(s: unknown): void } }).__store.setState({
      workspaces: [{ id: 'w', name: 'Missing CLI', cwd: '/tmp', layout: { type: 'pane', id: 'source' } }], activeWorkspaceId: 'w'
    }));
    await expect.poll(() => win.evaluate(() => window.api.checkAgentStart('source', 'claude'))).toBe('missing-cli');
    await win.getByRole('button', { name: 'Agent status', exact: true }).click();
    const dialog = win.getByRole('alertdialog');
    await dialog.getByRole('button', { name: 'Start agent', exact: true }).click();
    await expect(dialog.getByRole('status')).toContainText('not found');
    await expect(win.locator('.pane-agent-status')).toHaveCount(1);
    await expect(dialog.getByRole('button', { name: 'Start agent', exact: true })).toBeEnabled();
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('closing the start dialog cancels an in-flight installation check', async () => {
  test.skip(process.platform === 'win32', 'POSIX slow-profile fixture');
  const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-cancel-'));
  const testShell = join(dir, 'sh');
  writeFileSync(join(dir, 'opencode'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  writeFileSync(testShell, `#!/bin/sh
export PATH='${dir}:/usr/bin:/bin'
case "$1" in -ilc) /bin/sleep 1 ;; esac
exec /bin/bash --noprofile --norc "$@"
`, { mode: 0o700 });
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, SHELL: testShell, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => (window as unknown as { __store: { setState(s: unknown): void } }).__store.setState({
      workspaces: [{ id: 'w', name: 'Cancel start', cwd: '/tmp', layout: { type: 'pane', id: 'source' } }], activeWorkspaceId: 'w'
    }));
    await expect.poll(() => win.evaluate(() => window.api.checkAgentStart('source', 'opencode'))).toBe('ready');
    await win.getByRole('button', { name: 'Agent status', exact: true }).click();
    const dialog = win.getByRole('alertdialog');
    await dialog.getByRole('combobox').selectOption('opencode');
    await dialog.getByRole('button', { name: 'Start agent', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Checking installation …' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    // Wait beyond the known fixture delay; the late ready result must be inert.
    await win.waitForTimeout(1500);
    await expect(dialog).toHaveCount(0);
    await expect(win.locator('.pane-agent-status')).toHaveCount(1);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
