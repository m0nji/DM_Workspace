import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const win32 = process.platform === 'win32';

// A stand-in agent CLI: records argv, selected env and cwd, posts a Claude hook
// when --settings is present, then waits until the test writes "stop".
function writeRecorder(dir: string, name: string): string {
  const script = join(dir, `${name.replace(/\s/g, '-')}.cjs`);
  writeFileSync(script, `const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(join(dir, `record-${name.replace(/\s/g, '-')}.json`))}, JSON.stringify({ argv, env: { OLLAMA_HOST: process.env.OLLAMA_HOST ?? null, AGENT_NOTE: process.env.AGENT_NOTE ?? null }, cwd: process.cwd() }));
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', d => { if (d.includes(3)) process.exit(0); });
(async () => {
  const i = argv.indexOf('--settings');
  if (i >= 0) {
    const hook = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
    await fetch(hook.url, { method: 'POST', headers: { ...hook.headers, 'Content-Type': 'application/json', 'X-DMWS-Terminal': process.env.DMWS_AGENT_NONCE }, body: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: 'e2e-' + process.pid }) });
  }
  console.log('AGENT_STARTED');
  setInterval(() => { if (fs.existsSync(${JSON.stringify(join(dir, 'stop'))})) process.exit(0); }, 50);
})();
`);
  const launcher = join(dir, win32 ? `${name}.cmd` : name);
  writeFileSync(launcher, win32 ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o700 });
  return launcher;
}

async function launch(dir: string, userData: string): Promise<ElectronApplication> {
  const shell = join(dir, 'sh');
  if (!win32) writeFileSync(shell, `#!/bin/sh\nexport PATH='${dir}:/usr/bin:/bin'\nexec /bin/bash --noprofile --norc "$@"\n`, { mode: 0o700 });
  return electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: { ...process.env, DMWS_E2E: '1', DMWS_USERDATA: userData,
    ...(win32 ? { PATH: `${dir};${process.env.PATH ?? ''}` } : { SHELL: shell, PATH: `${dir}:/usr/bin:/bin` }) } });
}

async function workspace(win: Page, project: string): Promise<void> {
  // After the in-test restart, persisted workspaces render panes directly and
  // never show .welcome; wait for either so this helper works before and after.
  await expect(win.locator('.welcome, .pane').first()).toBeVisible();
  await win.evaluate(project => window.__store.setState({
    workspaces: [{ id: 'w', name: 'Profiles', cwd: project, layout: { type: 'pane', id: 'source' } }], activeWorkspaceId: 'w', paneCwd: { source: project }
  }), project);
  await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.source)).toBe('atPrompt');
}

const buffer = (win: Page, id: string) => win.evaluate(id => (window as unknown as { __bufferText: Map<string, () => string> }).__bufferText.get(id)?.() ?? '', id);

test.describe('agent profiles', () => {
  let dir: string; let project: string; let app: ElectronApplication; let win: Page;
  test.beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dmws-profiles-'));
    project = join(dir, "project 'q'");
    mkdirSync(project);
    mkdirSync(join(dir, 'userdata'));
    writeRecorder(dir, 'claude');
    writeRecorder(dir, 'fake agent');
    app = await launch(dir, join(dir, 'userdata'));
    win = await app.firstWindow();
    await workspace(win, project);
  });
  test.afterEach(async () => {
    writeFileSync(join(dir, 'stop'), '');
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('menu opens Claude to the right with logo and status, and a terminal below', async () => {
    const source = win.locator('.pane[data-pane-id="source"]');
    await source.getByRole('button', { name: 'New pane', exact: true }).click();
    const menu = win.getByRole('menu', { name: 'New pane' });
    await menu.getByRole('button', { name: 'Open Claude Code to the right' }).click();
    await expect(menu).toHaveCount(0);
    await expect(win.locator('.pane')).toHaveCount(2);
    expect(await win.evaluate(() => window.__store.getState().workspaces[0].layout)).toMatchObject({ type: 'split', direction: 'h' });
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    const pane = win.locator(`.pane[data-pane-id="${id}"]`);
    await expect(pane.getByRole('img', { name: 'Claude Code' })).toBeVisible();
    await expect(pane.locator('.pane-agent-status')).toContainText('Working');
    const record = JSON.parse(readFileSync(join(dir, 'record-claude.json'), 'utf8'));
    expect(realpathSync.native(record.cwd)).toBe(realpathSync.native(project));
    await source.getByRole('button', { name: 'New pane', exact: true }).click();
    await menu.getByRole('button', { name: 'Open Terminal below' }).click();
    await expect(win.locator('.pane')).toHaveCount(3);
  });

  test('custom profile passes arguments and environment exactly and leaves the shell clean', async () => {
    const command = win32 ? join(dir, 'fake agent.cmd') : 'fake agent';
    const args = ['--model', 'ollama/qwen3-coder', "it's a test", 'Grüße'];
    await win.evaluate(({ command, args }) => {
      const s = window.__store.getState();
      s.setAgentProfiles([...(s.settings.agentProfiles ?? []), { id: 'custom-e2e', adapter: 'generic', name: 'Fake (Ollama)',
        icon: { kind: 'letter', letter: 'F', color: '#c97b4a' }, command, args, env: { OLLAMA_HOST: 'http://localhost:11434', AGENT_NOTE: `it's $HOME "x"` }, showInMenu: true }]);
    }, { command, args });
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    await win.getByRole('menu').getByRole('button', { name: 'Open Fake (Ollama) below' }).click();
    const recordPath = join(dir, 'record-fake-agent.json');
    await expect.poll(() => existsSync(recordPath)).toBe(true);
    const record = JSON.parse(readFileSync(recordPath, 'utf8'));
    expect(record.argv).toEqual(args);
    expect(record.env).toEqual({ OLLAMA_HOST: 'http://localhost:11434', AGENT_NOTE: `it's $HOME "x"` });
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    await expect(win.locator(`.pane[data-pane-id="${id}"]`).getByRole('img', { name: 'Fake (Ollama)' })).toBeVisible();
    writeFileSync(join(dir, 'stop'), '');
    await expect.poll(() => win.evaluate(id => window.__store.getState().paneShell[id], id)).toBe('atPrompt');
    // paneShell flips to 'atPrompt' off the shell-integration OSC marker, which
    // bash prints (via PROMPT_COMMAND) a hair before PS1 and readline's own
    // terminal setup — usually not observable, but our stand-in leaves the pty
    // in the raw mode it set for itself, and readline briefly hasn't reclaimed
    // it yet. A single write sent right on that edge can go unread. Resending on
    // every poll (idempotent: only the fully-received line ever matters) rides
    // out that window without weakening what this asserts — the exported
    // AGENT_NOTE never reaching the interactive shell.
    const noteCommand = win32 ? 'Write-Output "NOTE=[$env:AGENT_NOTE]"\r' : 'echo "NOTE=[$AGENT_NOTE]"\r';
    await expect.poll(async () => {
      await win.evaluate(({ id, cmd }) => window.api.input({ paneId: id, data: cmd }), { id, cmd: noteCommand });
      return (await buffer(win, id)).replace(/\r?\n/g, '');
    }).toContain('NOTE=[]');
  });

  test('an agent without status reports opened from the menu shows as running, not as a start to prepare', async () => {
    const command = win32 ? join(dir, 'fake agent.cmd') : 'fake agent';
    await win.evaluate(command => {
      const s = window.__store.getState();
      s.setAgentProfiles([...(s.settings.agentProfiles ?? []), { id: 'custom-plain', adapter: 'generic', name: 'Plain', icon: { kind: 'letter', letter: 'P', color: '#336699' },
        command, args: [], env: {}, showInMenu: true }]);
    }, command);
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    await win.getByRole('menu').getByRole('button', { name: 'Open Plain to the right' }).click();
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    const pane = win.locator(`.pane[data-pane-id="${id}"]`);
    // The agent's output follows the shell's boot prompt, so its marker has
    // been parsed by now — the late marker must not reset the pane to the prompt.
    await expect.poll(async () => (await buffer(win, id)).replace(/\r?\n/g, '')).toContain('AGENT_STARTED');
    expect(await win.evaluate(id => window.__store.getState().paneShell[id], id)).toBe('running');
    await expect(pane.locator('.pane-agent-status')).toHaveText('No live status');
    await pane.getByRole('button', { name: 'Agent status', exact: true }).click();
    const dialog = win.getByRole('alertdialog');
    await expect(dialog.getByRole('button', { name: 'Go to terminal', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Start agent', exact: true })).toHaveCount(0);
  });

  test('missing program keeps a usable shell and can be retried after installing it', async () => {
    await win.evaluate(() => {
      const s = window.__store.getState();
      s.setAgentProfiles([...(s.settings.agentProfiles ?? []), { id: 'custom-late', adapter: 'generic', name: 'Late', icon: { kind: 'letter', letter: 'L', color: '#336699' },
        command: 'late-agent', args: [], env: {}, showInMenu: true }]);
    });
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    await win.getByRole('menu').getByRole('button', { name: 'Open Late to the right' }).click();
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    const pane = win.locator(`.pane[data-pane-id="${id}"]`);
    await expect(pane.locator('.pane-launch-issue')).toContainText('“late-agent” was not found');
    await expect.poll(() => win.evaluate(id => window.__store.getState().paneShell[id], id)).toBe('atPrompt');
    writeRecorder(dir, 'late-agent');
    await pane.getByRole('button', { name: 'Try again' }).click();
    await expect(pane.locator('.pane-launch-issue')).toHaveCount(0);
    await expect.poll(async () => (await buffer(win, id)).replace(/\r?\n/g, '')).toContain('AGENT_STARTED');
  });

  test('Try again runs one check at a time and is disabled while it is pending', async () => {
    await win.evaluate(() => {
      const s = window.__store.getState();
      s.setAgentProfiles([...(s.settings.agentProfiles ?? []), { id: 'custom-late', adapter: 'generic', name: 'Late', icon: { kind: 'letter', letter: 'L', color: '#336699' },
        command: 'late-agent', args: [], env: {}, showInMenu: true }]);
    });
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    await win.getByRole('menu').getByRole('button', { name: 'Open Late to the right' }).click();
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    const pane = win.locator(`.pane[data-pane-id="${id}"]`);
    await expect(pane.locator('.pane-launch-issue')).toContainText('“late-agent” was not found');
    await expect.poll(() => win.evaluate(id => window.__store.getState().paneShell[id], id)).toBe('atPrompt');
    // Hold the next checks open in main and count them.
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { checks: number; releaseCheck?: (check: string) => void };
      g.checks = 0;
      ipcMain.removeHandler('agent:check-start');
      ipcMain.handle('agent:check-start', () => { g.checks++; return new Promise<string>(resolve => { g.releaseCheck = resolve; }); });
    });
    const retry = pane.getByRole('button', { name: 'Try again' });
    // Two clicks in one task: the second arrives before React re-renders.
    await retry.evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(retry).toBeDisabled();
    expect(await app.evaluate(() => (globalThis as unknown as { checks: number }).checks)).toBe(1);
    await app.evaluate(() => (globalThis as unknown as { releaseCheck: (check: string) => void }).releaseCheck('missing-cli'));
    await expect(retry).toBeEnabled();
    await expect(pane.locator('.pane-launch-issue')).toContainText('“late-agent” was not found');
    expect(await app.evaluate(() => (globalThis as unknown as { checks: number }).checks)).toBe(1);
  });

  test('restarting an agent whose profile was deleted needs an explicit choice', async () => {
    const command = win32 ? join(dir, 'fake agent.cmd') : 'fake agent';
    await win.evaluate(command => {
      const s = window.__store.getState();
      s.setAgentProfiles([...(s.settings.agentProfiles ?? []), { id: 'custom-gone', adapter: 'generic', name: 'Gone', icon: { kind: 'letter', letter: 'G', color: '#336699' },
        command, args: [], env: {}, showInMenu: true }]);
    }, command);
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    await win.getByRole('menu').getByRole('button', { name: 'Open Gone to the right' }).click();
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    const pane = win.locator(`.pane[data-pane-id="${id}"]`);
    await expect.poll(async () => (await buffer(win, id)).replace(/\r?\n/g, '')).toContain('AGENT_STARTED');
    await win.evaluate(() => {
      const s = window.__store.getState();
      s.setAgentProfiles((s.settings.agentProfiles ?? []).filter(p => p.id !== 'custom-gone'));
    });
    writeFileSync(join(dir, 'stop'), '');
    await expect(pane.locator('.pane-agent-status')).toHaveText('Session ended');
    await pane.getByRole('button', { name: 'Agent status', exact: true }).click();
    const dialog = win.getByRole('alertdialog');
    const agent = dialog.getByRole('combobox', { name: 'Agent', exact: true });
    await expect(agent).toHaveValue('');
    await expect(dialog).toContainText('The agent “Gone” no longer exists. Choose an agent to start.');
    await expect(dialog.getByRole('button', { name: 'Restart', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Show start command (manual)' })).toHaveCount(0);
    await agent.selectOption('claude');
    await expect(dialog.getByRole('button', { name: 'Restart', exact: true })).toBeEnabled();
    await expect(dialog).not.toContainText('no longer exists');
  });

  test('the profile editor links to Claude in the browser and to the OpenCode web guide', async () => {
    await app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { opened: string[] };
      g.opened = [];
      ipcMain.removeAllListeners('shell:openExternal');
      ipcMain.on('shell:openExternal', (_event, url: string) => { g.opened.push(url); });
    });
    await win.evaluate(() => window.__store.getState().openAgentSettings());
    const rows = win.locator('.agent-profile-list .agent-profile-row');
    await rows.filter({ hasText: 'Claude Code' }).click();
    await win.locator('.agent-profile-editor').getByRole('button', { name: 'Open Claude in browser' }).click();
    await rows.filter({ hasText: 'OpenCode' }).click();
    await expect(win.locator('.agent-profile-editor').getByRole('button', { name: 'Open Claude in browser' })).toHaveCount(0);
    await win.locator('.agent-profile-editor').getByRole('button', { name: 'Set up web access – guide' }).click();
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
      .toEqual(['https://claude.ai/code', 'https://opencode.ai/docs/web/']);
  });

  test('the new-pane menu closes when something scrolls, but not on terminal output', async () => {
    const source = win.locator('.pane[data-pane-id="source"]');
    await source.getByRole('button', { name: 'New pane', exact: true }).click();
    const menu = win.getByRole('menu', { name: 'New pane' });
    await expect(menu).toBeVisible();
    // Streaming output scrolls the terminal buffer, not the page.
    const lines = win32 ? '1..300 | ForEach-Object { "line $_" }\r' : 'seq 1 300\r';
    await win.evaluate(data => window.api.input({ paneId: 'source', data }), lines);
    await expect.poll(async () => (await buffer(win, 'source')).includes('300')).toBe(true);
    await expect(menu).toBeVisible();
    await win.evaluate(() => document.querySelector('.pane-body')!.dispatchEvent(new Event('scroll')));
    await expect(menu).toHaveCount(0);
  });

  test('menu works with the keyboard and returns focus on Escape', async () => {
    const source = win.locator('.pane[data-pane-id="source"]');
    await source.getByRole('button', { name: 'New pane', exact: true }).click();
    const menu = win.getByRole('menu', { name: 'New pane' });
    await expect(menu.getByRole('menuitem', { name: 'Terminal' })).toBeFocused();
    await win.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(source.getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
    await source.getByRole('button', { name: 'New pane', exact: true }).click();
    await win.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Claude Code' })).toBeFocused();
    await win.keyboard.press('ArrowUp');
    await win.keyboard.press('Shift+Enter');
    await expect(win.locator('.pane')).toHaveCount(2);
    expect(await win.evaluate(() => window.__store.getState().workspaces[0].layout)).toMatchObject({ type: 'split', direction: 'v' });
  });

  test('settings add, duplicate, reorder, hide and delete profiles and keep them after restart', async () => {
    await win.evaluate(() => window.__store.getState().openAgentSettings());
    const settings = win.locator('.agent-profile-list');
    // `.agent-profile-item` also contains the editor once one is open, and an
    // open editor's adapter <select> carries every adapter name (e.g. "Codex")
    // as hidden <option> text, which would make a later hasText('Codex') match
    // the wrong item. `.agent-profile-row` is the row line only, never the
    // editor, so it stays unambiguous; the single open editor's own fields are
    // reached through `.agent-profile-editor` instead of a name-based filter
    // (a filter re-evaluates on every action, and by the second fill the
    // duplicate has already been renamed away from "OpenCode (copy)").
    await settings.locator('.agent-profile-row').filter({ hasText: 'OpenCode' }).click();
    const openCodeActions = settings.locator('.agent-profile-row').filter({ hasText: 'OpenCode' }).getByRole('button', { name: 'Actions for OpenCode' });
    await openCodeActions.click();
    // The menu portals outside the row, so it must grab focus itself on open
    // and hand it back to its trigger on close, or keyboard users lose their
    // place entirely (fix round 1, 2026-09-25).
    await expect(win.locator('.context-menu-item').first()).toBeFocused();
    await win.keyboard.press('Escape');
    await expect(win.locator('.context-menu')).toHaveCount(0);
    await expect(openCodeActions).toBeFocused();
    await openCodeActions.click();
    await win.locator('.context-menu-item', { hasText: 'Duplicate' }).click();
    const editor = win.locator('.agent-profile-editor');
    await editor.getByLabel('Name', { exact: true }).fill('OpenCode (Ollama)');
    await editor.getByLabel('Arguments').fill('--model ollama/qwen3-coder');
    await settings.locator('.agent-profile-row').filter({ hasText: 'OpenCode (Ollama)' }).getByRole('button', { name: 'Actions for OpenCode (Ollama)' }).click();
    await win.locator('.context-menu-item', { hasText: 'Move up' }).click();
    await settings.locator('.agent-profile-row').filter({ hasText: 'Codex' }).getByLabel('Show in menu: Codex').uncheck();
    const saved = await win.evaluate(() => window.__store.getState().settings.agentProfiles!.map(p => [p.name, p.showInMenu, p.args]));
    expect(saved).toEqual([['Claude Code', true, []], ['Codex', false, []], ['OpenCode (Ollama)', true, ['--model', 'ollama/qwen3-coder']], ['OpenCode', true, []]]);
    await win.keyboard.press('Escape');
    await app.close();
    app = await launch(dir, join(dir, 'userdata'));
    win = await app.firstWindow();
    await workspace(win, project);
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    const names = await win.getByRole('menu').locator('.new-pane-name').allInnerTexts();
    expect(names).toEqual(['Terminal', 'Claude Code', 'OpenCode (Ollama)', 'OpenCode']);
    await win.keyboard.press('Escape');
    await win.evaluate(() => window.__store.getState().openAgentSettings());
    const item = win.locator('.agent-profile-row').filter({ hasText: 'OpenCode (Ollama)' });
    await item.click();
    await win.locator('.agent-profile-editor').getByRole('button', { name: 'Delete' }).click();
    const confirm = win.getByRole('alertdialog');
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await confirm.getByRole('button', { name: 'Delete' }).click();
    await expect(win.locator('.agent-profile-row').filter({ hasText: 'OpenCode (Ollama)' })).toHaveCount(0);
  });

  test('a manually typed opencode shows the OpenCode logo', async () => {
    writeRecorder(dir, 'opencode');
    const source = win.locator('.pane[data-pane-id="source"]');
    // Real keystrokes: the title tracker only sees input typed into xterm.
    await source.getByRole('textbox', { name: 'Terminal input' }).pressSequentially('opencode');
    await win.keyboard.press('Enter');
    await expect(source.getByRole('img', { name: 'OpenCode' })).toBeVisible();
    writeFileSync(join(dir, 'stop'), '');
    await expect(source.getByRole('img', { name: 'OpenCode' })).toHaveCount(0);
  });

  test('Windows rejects quotes for .cmd launchers before starting', async () => {
    test.skip(!win32, 'Windows argument rules');
    await win.evaluate(command => {
      const s = window.__store.getState();
      s.setAgentProfiles([...(s.settings.agentProfiles ?? []), { id: 'custom-quote', adapter: 'generic', name: 'Quote', icon: { kind: 'letter', letter: 'Q', color: '#336699' },
        command, args: ['a"b'], env: {}, showInMenu: true }]);
    }, join(dir, 'fake agent.cmd'));
    await win.locator('.pane[data-pane-id="source"]').getByRole('button', { name: 'New pane', exact: true }).click();
    await win.getByRole('menu').getByRole('button', { name: 'Open Quote to the right' }).click();
    const id = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    await expect(win.locator(`.pane[data-pane-id="${id}"] .pane-launch-issue`)).toContainText('cannot be passed reliably');
    expect(existsSync(join(dir, 'record-fake-agent.json'))).toBe(false);
  });
});
