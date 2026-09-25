import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const win32 = process.platform === 'win32';

// Stand-in "claude" CLI (same pattern as e2e/agent-profiles.spec.ts's
// recorder): logs every stdin write to a file, so the test can tell whether
// "/clear" was actually sent to it. It also fires its own UserPromptSubmit
// + Stop hooks right after start, so the pane reaches the idle "Response
// ended" status before the test clears — an agent that is still "working"
// must never be interrupted by an auto-sent command.
function writeClaudeRecorder(dir: string): string {
  const script = join(dir, 'claude.cjs');
  writeFileSync(script, `const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.writeFileSync(${JSON.stringify(join(dir, 'record-claude.json'))}, JSON.stringify({ argv }));
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', d => {
  fs.appendFileSync(${JSON.stringify(join(dir, 'stdin-claude.log'))}, d);
  if (d.includes(3)) process.exit(0);
});
(async () => {
  const i = argv.indexOf('--settings');
  if (i >= 0) {
    const hook = JSON.parse(fs.readFileSync(argv[i + 1], 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
    const post = (hook_event_name) => fetch(hook.url, { method: 'POST', headers: { ...hook.headers, 'Content-Type': 'application/json', 'X-DMWS-Terminal': process.env.DMWS_AGENT_NONCE }, body: JSON.stringify({ hook_event_name, session_id: 'e2e-' + process.pid }) });
    await post('UserPromptSubmit');
    await post('Stop');
  }
  console.log('AGENT_STARTED');
  setInterval(() => { if (fs.existsSync(${JSON.stringify(join(dir, 'stop'))})) process.exit(0); }, 50);
})();
`);
  const launcher = join(dir, win32 ? 'claude.cmd' : 'claude');
  writeFileSync(launcher, win32 ? `@"${process.execPath}" "${script}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o700 });
  return launcher;
}

async function launch(dir: string): Promise<ElectronApplication> {
  const shell = join(dir, 'sh');
  if (!win32) writeFileSync(shell, `#!/bin/sh\nexport PATH='${dir}:/usr/bin:/bin'\nexec /bin/bash --noprofile --norc "$@"\n`, { mode: 0o700 });
  return electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: {
      ...process.env, DMWS_E2E: '1',
      ...(win32 ? { PATH: `${dir};${process.env.PATH ?? ''}` } : { SHELL: shell, PATH: `${dir}:/usr/bin:/bin` })
    }
  });
}

const buffer = (win: Page, id: string) => win.evaluate(id => (window as unknown as { __bufferText: Map<string, () => string> }).__bufferText.get(id)?.() ?? '', id);

test('Clear all windows starts a new conversation in an idle agent pane and leaves a plain shell alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-clear-agents-'));
  const project = join(dir, 'project');
  mkdirSync(project);
  writeClaudeRecorder(dir);
  const app = await launch(dir);
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome, .pane').first()).toBeVisible();
    await win.evaluate(project => window.__store.setState({
      workspaces: [{ id: 'w', name: 'Clear', cwd: project, layout: { type: 'pane', id: 'source' } }],
      activeWorkspaceId: 'w', paneCwd: { source: project }
    }), project);
    await expect.poll(() => win.evaluate(() => window.__store.getState().paneShell.source)).toBe('atPrompt');

    // Open a Claude Code pane next to the plain shell.
    const source = win.locator('.pane[data-pane-id="source"]');
    await source.getByRole('button', { name: 'New pane', exact: true }).click();
    const newPaneMenu = win.getByRole('menu', { name: 'New pane' });
    await newPaneMenu.getByRole('button', { name: 'Open Claude Code to the right' }).click();
    await expect(win.locator('.pane')).toHaveCount(2);
    const agentId = await win.evaluate(() => window.__store.getState().focusedPaneId!);
    const agentPane = win.locator(`.pane[data-pane-id="${agentId}"]`);
    // The stand-in already fired UserPromptSubmit + Stop: wait for the idle
    // status so clearing does not (correctly) treat it as busy.
    await expect(agentPane.locator('.pane-agent-status')).toHaveText('Response ended');

    // Right-click the plain shell and clear all windows.
    await source.locator('.xterm-host-wrap').click({ button: 'right' });
    await expect(win.locator('.context-menu-item', { hasText: 'Clear All Windows' })).toBeVisible();
    await win.locator('.context-menu-item', { hasText: 'Clear All Windows' }).click();
    await expect(win.locator('.confirm-message')).toContainText('1 agent will start a new conversation.');
    await win.locator('.confirm-btn', { hasText: 'Clear all' }).click();
    await expect(win.locator('.confirm-modal')).toHaveCount(0);

    // The agent pane received its "/clear" — the recorder logged the raw bytes.
    const stdinLog = join(dir, 'stdin-claude.log');
    await expect.poll(() => (existsSync(stdinLog) ? readFileSync(stdinLog, 'utf8') : '')).toContain('/clear');

    // The plain shell was only cleared, never sent a command: a real shell
    // echoes typed input, so its buffer would show the literal text "/clear"
    // if it had wrongly received one.
    await expect.poll(() => buffer(win, 'source')).not.toContain('/clear');
  } finally {
    writeFileSync(join(dir, 'stop'), '');
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
