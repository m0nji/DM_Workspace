import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { codexSetup } from '../src/main/codex-status-setup';

test('Codex arguments survive Windows PowerShell and pwsh with npm and native installs', () => {
  test.skip(process.platform !== 'win32', 'Windows native argument parsing');
  const dir = mkdtempSync(join(tmpdir(), 'dmws-codex-argv-'));
  try {
    const npmDir = join(dir, 'npm');
    const nativeDir = join(dir, 'native');
    mkdirSync(npmDir);
    mkdirSync(nativeDir);
    const recorder = join(npmDir, 'record.cjs');
    writeFileSync(recorder, "process.argv.slice(2).forEach(arg => console.log(Buffer.from(arg).toString('base64')));\n");
    writeFileSync(join(npmDir, 'codex.cmd'), `@"${process.execPath}" "${recorder}" %*\r\n`);
    writeFileSync(join(npmDir, 'codex.ps1'), "throw 'Must select native npm shim'\r\n");
    // Compile a tiny argv recorder with Windows' own .NET compiler. This tests
    // the EXE branch, which pwsh handles differently from batch files.
    const source = 'using System; class Recorder { static void Main(string[] args) { foreach (var arg in args) Console.WriteLine(Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(arg))); } }';
    const exe = join(nativeDir, 'codex.exe').replace(/'/g, "''");
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Add-Type -TypeDefinition '${source}' -OutputAssembly '${exe}' -OutputType ConsoleApplication`]);
    const hookPath = join(dir, "hooks with 'quotes' & %PATH%.cjs");
    const posix = codexSetup(hookPath, 1234, 'test-token', false).command;
    const expected = posix.slice("codex -c '".length, -1).replaceAll("'\\''", "'");
    for (const shell of ['powershell.exe', 'pwsh.exe']) {
      for (const bin of [npmDir, nativeDir]) {
        const command = codexSetup(hookPath, 1234, 'test-token', true).command;
        const output = execFileSync(shell, ['-NoProfile', '-NonInteractive', '-Command', command], {
          env: { ...process.env, PATH: `${bin};${process.env.PATH ?? ''}` }, encoding: 'utf8', timeout: 10000
        });
        const args = output.trim().split(/\r?\n/).map(line => Buffer.from(line, 'base64').toString());
        expect(args, `${shell} via ${bin}`).toEqual(['-c', expected]);
      }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Real shell, PTY, hook bridge and UI; stand-in CLIs avoid paid model requests.
for (const provider of ['claude', 'codex', 'opencode'] as const) {
  test(`${provider} starts by button in the current pane and reports status`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dmws-agent-start-'));
    const project = join(dir, "project with 'quotes'");
    mkdirSync(project);
    const useZsh = process.platform === 'darwin' && provider === 'codex';
    if (useZsh) writeFileSync(join(dir, '.zshrc'), `export PATH='${dir}:/usr/bin:/bin'\n`);
    const testShell = useZsh ? '/bin/zsh' : join(dir, 'sh');
    if (!useZsh && process.platform !== 'win32') writeFileSync(testShell, `#!/bin/sh\nexport PATH='${dir}:/usr/bin:/bin'\nexec /bin/bash --noprofile --norc "$@"\n`, { mode: 0o700 });
    if (process.platform === 'win32') copyFileSync(process.execPath, join(dir, 'node.exe'));
    else symlinkSync(process.execPath, join(dir, 'node'));
    const fixture = join(dir, process.platform === 'win32' ? 'agent-fixture.cjs' : provider);
    writeFileSync(fixture, `#!${process.execPath}
const fs = require('node:fs');
const cp = require('node:child_process');
(async () => {
  while (!fs.existsSync(${JSON.stringify(join(dir, 'allow-report'))})) await new Promise(resolve => setTimeout(resolve, 20));
  if (${JSON.stringify(provider)} === 'claude') {
    const settings = JSON.parse(fs.readFileSync(process.argv[process.argv.indexOf('--settings') + 1], 'utf8'));
    const hook = settings.hooks.UserPromptSubmit[0].hooks[0];
    const res = await fetch(hook.url, { method: 'POST', headers: { ...hook.headers, 'Content-Type': 'application/json', 'X-DMWS-Terminal': process.env.DMWS_AGENT_NONCE }, body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'direct-start-' + process.pid }) });
    if (!res.ok) process.exit(7);
  } else if (${JSON.stringify(provider)} === 'codex') {
    const config = process.argv[process.argv.indexOf('-c') + 1];
    if (process.argv.length !== 4 || !config.includes('type = "command"')) throw new Error('Corrupt Codex argv: ' + JSON.stringify(process.argv.slice(2)));
    const encoded = config.match(/Buffer.from\\('([^']+)'/)[1];
    const path = Buffer.from(encoded, 'base64').toString();
    const child = cp.spawnSync(process.execPath, [path], { env: process.env, input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'direct-start-' + process.pid, turn_id: 'turn-' + process.pid }) });
    if (child.status !== 0) process.exit(8);
  }
  fs.writeFileSync(${JSON.stringify(join(dir, 'agent-pid'))}, String(process.pid));
  if (fs.existsSync(${JSON.stringify(join(dir, 'spawn-child'))})) {
    const child = cp.spawn(process.execPath, ['-e', 'process.title = "dmws-e2e-agent-child"; setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(join(dir, 'child-pid'))}, String(child.pid));
    process.on('exit', () => { try { child.kill(); } catch {} });
  }
  console.log('AGENT_STARTED_IN=' + process.cwd());
  setInterval(() => { if (fs.existsSync(${JSON.stringify(join(dir, 'stop'))})) process.exit(0); }, 50);
})().catch(e => { console.error(e); process.exit(9); });
`, { mode: 0o700 });
    if (process.platform === 'win32') writeFileSync(join(dir, `${provider}.cmd`), `@"${process.execPath}" "${fixture}" %*\r\n`);
    if (process.platform === 'win32' && provider === 'codex') writeFileSync(join(dir, 'codex.ps1'), "throw 'The native Codex shim should be selected'\r\n");
    const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env,
      ...(process.platform === 'win32' ? { PATH: `${dir};${process.env.PATH ?? ''}` } : { SHELL: testShell, PATH: `${dir}:/usr/bin:/bin`, ...(useZsh ? { ZDOTDIR: dir } : {}) }), DMWS_E2E: '1' } });
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
      await expect.poll(() => win.evaluate(() => (window as unknown as {
        __store: { getState(): { paneShell: Record<string, string> } }
      }).__store.getState().paneShell.original)).toBe('atPrompt');
      // Replace unfinished shell input without executing it as part of the agent command.
      await win.evaluate(() => window.api.input({ paneId: 'original', data: 'unfinished-input' }));
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      const dialog = win.getByRole('alertdialog');
      await dialog.getByRole('combobox').selectOption(provider);
      // The shell's first cwd report can replace an 8.3 Windows path (and
      // backslashes) while the dialog is open. Compare the actual directory.
      await expect.poll(async () => realpathSync.native((await dialog.locator('.agent-folder').innerText()).replace(/(?:New|Current) pane in folder: /, ''))).toBe(realpathSync.native(project));
      await expect(dialog.locator('code')).toHaveCount(0);
      await win.screenshot({ path: join(tmpdir(), `dmws-direct-start-${provider}.png`) });
      await dialog.getByRole('button', { name: 'Start agent', exact: true }).click();
      await expect.poll(async () => {
        if (await dialog.count() === 0) return 'started';
        return await dialog.innerText();
      }).toBe('started');
      await expect(win.locator('.pane-agent-status')).toHaveCount(1);
      await expect(original.locator('.pane-agent-status')).toContainText(provider === 'opencode' ? 'No live status' : 'Waiting for status');
      writeFileSync(join(dir, 'allow-report'), '');
      const buffers = () => win.evaluate(() => Object.fromEntries([...((window as unknown as { __bufferText: Map<string, () => string> }).__bufferText)].map(([id, read]) => [id, read()])));
      await expect.poll(async () => (await buffers()).original.replace(/\r?\n/g, '')).toContain(`AGENT_STARTED_IN=${realpathSync.native(project)}`);
      await expect(win.locator('.pane-agent-status').filter({ hasText: `${provider === 'claude' ? 'Claude Code' : provider === 'codex' ? 'Codex' : 'OpenCode'} · ${provider === 'opencode' ? 'No live status' : 'Working'}` })).toHaveCount(1);
      expect((await buffers()).original).not.toContain('unfinished-input: command not found');
      await expect(original.locator('.pane-label.automatic')).toHaveText(provider);
      await expect(original.getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
      await win.screenshot({ path: join(tmpdir(), `dmws-direct-start-${provider}-running.png`) });
      // A completed CLI must leave this same pane ready for another launch.
      writeFileSync(join(dir, 'stop'), '');
      await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.original)).toBe('atPrompt');
      await expect.poll(() => win.evaluate(() => window.__store.getState().agentStates.original?.sessionId ?? null)).toBe(null);
      rmSync(join(dir, 'stop'));
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      await dialog.getByRole('button', { name: 'Restart', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () => ((await buffers()).original.match(/AGENT_STARTED_IN=/g) ?? []).length).toBe(2);
      await original.getByRole('textbox', { name: 'Terminal input' }).press('Control+c');
      await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.original)).toBe('atPrompt');
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      await dialog.getByRole('button', { name: 'Restart', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () => ((await buffers()).original.match(/AGENT_STARTED_IN=/g) ?? []).length).toBe(3);
      // Pause/reconnect keeps exactly the same CLI process and generation.
      const pid = Number(readFileSync(join(dir, 'agent-pid'), 'utf8'));
      const generation = await win.evaluate(() => window.__store.getState().agentStates.original.generation);
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      await dialog.getByRole('button', { name: 'Pause status reporting', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(original.locator('.pane-agent-status')).toContainText('Status paused');
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      await expect(dialog).toContainText('same session');
      await dialog.getByRole('button', { name: 'Reconnect', exact: true }).click();
      await expect(original.locator('.pane-agent-status')).toContainText(provider === 'opencode' ? 'No live status' : 'Working');
      expect(Number(readFileSync(join(dir, 'agent-pid'), 'utf8'))).toBe(pid);
      expect(await win.evaluate(() => window.__store.getState().agentStates.original.generation)).toBe(generation);
      // Cancellation cannot terminate the session. Confirming must kill the CLI.
      await dialog.getByRole('button', { name: 'End agent session', exact: true }).click();
      await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      expect(() => process.kill(pid, 0)).not.toThrow();
      await dialog.getByRole('button', { name: 'End agent session', exact: true }).click();
      await dialog.getByRole('button', { name: 'End agent session', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.original)).toBe('atPrompt');
      await expect.poll(() => { try { process.kill(pid, 0); return true; } catch { return false; } }).toBe(false);
      await expect(win.locator('.pane')).toHaveCount(1);
      expect(realpathSync.native(await win.evaluate(() => window.__store.getState().paneCwd.original))).toBe(realpathSync.native(project));
      expect(((await buffers()).original.replace(/\n/g, '').match(/AGENT_STARTED_IN=/g) ?? []).length).toBe(3);
      await expect(original.locator('.pane-agent-status')).toContainText('Session ended');
      // A stale end request from the previous session cannot kill a later one.
      writeFileSync(join(dir, 'spawn-child'), '');
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      await dialog.getByRole('button', { name: 'Restart', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(async () => ((await buffers()).original.replace(/\n/g, '').match(/AGENT_STARTED_IN=/g) ?? []).length).toBe(4);
      const childPid = Number(readFileSync(join(dir, 'child-pid'), 'utf8'));
      expect(await win.evaluate(async generation => { try { await window.api.endAgentSession('original', generation!); return 'ended'; } catch { return 'rejected'; } }, generation)).toBe('rejected');
      expect(() => process.kill(childPid, 0)).not.toThrow();
      await original.getByRole('button', { name: 'Agent status', exact: true }).click();
      await dialog.getByRole('button', { name: 'End agent session', exact: true }).click();
      await dialog.getByRole('button', { name: 'End agent session', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect.poll(() => { try { process.kill(childPid, 0); return true; } catch { return false; } }).toBe(false);
      await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.original)).toBe('atPrompt');

    } finally {
      // Stop our stand-in explicitly. On Linux a PTY child can retain inherited
      // descriptors after Electron exits, which Playwright waits to close.
      writeFileSync(join(dir, 'stop'), '');
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
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

test('programmatic commands disarm the shell prompt before another agent can start', async () => {
  test.skip(process.platform === 'win32', 'POSIX sleep fixture');
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1' } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => (window as unknown as { __store: { setState(s: unknown): void } }).__store.setState({
      workspaces: [{ id: 'w', name: 'Programmatic input', cwd: '/tmp', layout: { type: 'pane', id: 'source' } }], activeWorkspaceId: 'w'
    }));
    const shell = () => win.evaluate(() => (window as unknown as { __store: { getState(): { paneShell: Record<string, string> } } }).__store.getState().paneShell.source);
    await expect.poll(shell).toBe('atPrompt');
    const afterSubmit = await win.evaluate(() => {
      const store = (window as unknown as { __store: { getState(): { runTaskInPane(id: string, command: string): void; paneShell: Record<string, string> } } }).__store;
      store.getState().runTaskInPane('source', 'sleep 2');
      return store.getState().paneShell.source;
    });
    expect(afterSubmit).toBe('running');
    await expect.poll(shell).toBe('atPrompt');
  } finally { await app.close(); }
});
