import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('agent settings persist preferences and pair through fixed CLI operations without saving codes', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-remote-ui-'));
  const log = join(dir, 'calls.jsonl');
  const fixture = join(dir, 'codex-fixture.cjs');
  writeFileSync(fixture, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
if (args[0] === 'app-server') console.log(JSON.stringify({ status: 'running' }));
else if (args[1] === 'start') console.log(JSON.stringify({ status: 'connected', timedOut: false }));
else if (args[1] === 'pair') console.log(JSON.stringify({ manualPairingCode: 'ABCD-EFGH', pairingCode: 'INTERNAL-SECRET', expiresAt: Math.floor(Date.now()/1000)+600 }));
else process.exit(1);
`, { mode: 0o700 });
  const shell = join(dir, 'sh');
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'codex.cmd'), `@"${process.execPath}" "${fixture}" %*\r\n`);
    writeFileSync(join(dir, 'codex.ps1'), "throw 'must use Application'\r\n");
  } else {
    writeFileSync(join(dir, 'codex'), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
    writeFileSync(shell, `#!/bin/sh\nexport PATH='${dir}:/usr/bin:/bin'\nexec /bin/bash --noprofile --norc "$@"\n`, { mode: 0o700 });
  }
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: {
    ...process.env, DMWS_E2E: '1',
    ...(process.platform === 'win32' ? { PATH: `${dir};${process.env.PATH}` } : { SHELL: shell })
  } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.evaluate(() => {
      (window as unknown as { __store: { getState(): { setSettingsOpen(open: boolean): void } } }).__store.getState().setSettingsOpen(true);
    });
    await win.getByRole('button', { name: 'AI agents', exact: true }).click();
    await expect(win.locator('#codex-remote')).not.toBeChecked();
    await win.locator('#codex-remote').check();
    await win.locator('#claude-remote').check();
    await expect.poll(() => win.evaluate(async () => (await window.api.loadState()).settings.agentRemoteControl)).toEqual({ codex: true, claude: true });
    await win.getByRole('button', { name: 'Check service', exact: true }).click();
    await expect(win.getByText('The local Codex service is running.', { exact: false })).toBeVisible();
    expect(readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))).toEqual([['app-server', 'daemon', 'version']]);
    await win.getByRole('button', { name: 'Pair phone', exact: true }).click();
    await expect(win.getByText('ABCD-EFGH', { exact: true })).toBeVisible();
    expect(JSON.stringify(await win.evaluate(() => window.api.loadState()))).not.toContain('ABCD-EFGH');
    expect(await win.locator('body').innerText()).not.toContain('INTERNAL-SECRET');
    await win.screenshot({ path: join(tmpdir(), 'dmws-agent-settings.png') });
    await win.locator('#codex-remote').uncheck();
    await expect.poll(() => win.evaluate(async () => (await window.api.loadState()).settings.agentRemoteControl)).toEqual({ codex: false, claude: true });
    // Turning off automatic startup must not terminate the shared daemon.
    const calls = readFileSync(log, 'utf8');
    expect(calls).not.toContain('stop');
    expect(calls).not.toContain('disable');
    expect(await win.evaluate(async () => { try { await window.api.codexRemote('invalid' as 'status'); return 'accepted'; } catch { return 'rejected'; } })).toBe('rejected');
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
