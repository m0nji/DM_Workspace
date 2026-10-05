import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('smartphone access enables, pairs and disables persistently in German and English', async () => {
  test.setTimeout(120000);
  const dir = mkdtempSync(join(tmpdir(), 'dmws-smartphone-ui-'));
  const log = join(dir, 'calls.jsonl');
  const preference = join(dir, 'app-server-daemon', 'settings.json');
  const failDisable = join(dir, 'fail-disable');
  mkdirSync(join(dir, 'app-server-daemon'));
  writeFileSync(preference, JSON.stringify({ remoteControlEnabled: false, running: true }));
  const fixture = join(dir, 'codex-fixture.cjs');
  writeFileSync(fixture, `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const file = ${JSON.stringify(preference)}, state = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
if (args[0] === 'app-server' && args[2] === 'version') console.log(JSON.stringify({ status: state.running ? 'running' : 'stopped', cliVersion: '0.160.0', socketPath: ${JSON.stringify(join(dir, 'app-server-control', 'app-server-control.sock'))} }));
else if (args[0] === 'app-server' && args[2] === 'disable-remote-control') {
  if(fs.existsSync(${JSON.stringify(failDisable)})) { console.error('PRIVATE-CLI-ERROR'); process.exit(1); }
  state.remoteControlEnabled=false; save(); console.log('Disabled');
} else if (args[0] === '--help') console.log('--no-daemon');
else if (args[1] === 'start') { state.running=true; state.remoteControlEnabled=true; save(); console.log(JSON.stringify({ status: 'connected', timedOut: false })); }
else if (args[1] === 'stop') { state.running=false; save(); console.log(JSON.stringify({ status: 'stopped' })); }
else if (args[1] === 'pair' && state.remoteControlEnabled) console.log(JSON.stringify({ manualPairingCode: 'ABCD-EFGH', pairingCode: 'INTERNAL-SECRET', expiresAt: Math.floor(Date.now()/1000)+600 }));
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
    ...process.env, DMWS_E2E: '1', CODEX_HOME: dir,
    ...(process.platform === 'win32' ? { PATH: `${dir};${process.env.PATH}` } : { SHELL: shell })
  } });
  try {
    const win = await app.firstWindow();
    await expect(win.locator('.welcome')).toBeVisible();
    await win.getByRole('button', { name: 'Manage smartphone access', exact: true }).click();
    const access = win.getByRole('switch', { name: 'Control Codex from your smartphone' });
    await expect(access).not.toBeChecked(); await expect(access).toBeEnabled();
    await expect(win.getByRole('button', { name: 'Pair smartphone', exact: true })).toBeDisabled();
    const calls = (): string[][] => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(calls().every(args => args.join(' ') === 'app-server daemon version')).toBe(true);
    await access.click(); await expect(access).toBeChecked(); await expect(access).toBeEnabled();
    await expect(win.locator('.codex-smartphone-status')).toContainText('Remote service connected');
    await win.getByRole('switch', { name: 'Share new Codex sessions with your smartphone' }).check();
    await expect.poll(() => win.evaluate(async () => (await window.api.loadState()).settings.codexRemoteAccess)).toBe(true);
    await win.getByRole('button', { name: 'Check status', exact: true }).click();
    await expect(win.locator('.codex-smartphone-status')).toContainText('remote connection unconfirmed');
    await expect(access).toBeEnabled();
    await win.getByRole('button', { name: 'Pair smartphone', exact: true }).click();
    const dialog = win.getByRole('alertdialog');
    await expect(dialog.getByText('ABCD-EFGH', { exact: true })).toBeVisible();
    expect(JSON.stringify(await win.evaluate(() => window.api.loadState()))).not.toContain('ABCD-EFGH');
    expect(await win.locator('body').innerText()).not.toContain('INTERNAL-SECRET');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    writeFileSync(failDisable, ''); await access.click();
    await expect(win.locator('.codex-smartphone-status')).toContainText('could not be confirmed');
    await expect(access).toBeChecked();
    expect(await win.locator('body').innerText()).not.toContain('PRIVATE-CLI-ERROR');
    expect((await win.evaluate(() => window.api.loadState())).settings.codexRemoteAccess).toBe(true);
    rmSync(failDisable); await access.click(); await expect(access).not.toBeChecked(); await expect(access).toBeEnabled();
    await expect.poll(() => win.evaluate(async () => (await window.api.loadState()).settings.codexRemoteAccess)).toBe(false);
    expect(JSON.parse(readFileSync(preference, 'utf8')).running).toBe(true);
    expect(calls().some(args => args.includes('stop'))).toBe(false);
    await win.evaluate(() => window.__store.getState().updateSettings({ locale: 'de' }));
    await expect(win.getByRole('switch', { name: 'Codex vom Smartphone steuern' })).not.toBeChecked();
    await expect(win.getByRole('button', { name: 'Smartphone koppeln', exact: true })).toBeDisabled();
    await win.getByRole('switch', { name: 'Codex vom Smartphone steuern' }).click();
    await expect(win.getByRole('switch', { name: 'Codex vom Smartphone steuern' })).toBeEnabled();
    await win.locator('.agent-remote-help summary').click();
    await win.getByRole('button', { name: 'Gesamten Codex-Dienst stoppen …', exact: true }).click();
    await win.getByRole('alertdialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
    expect(JSON.parse(readFileSync(preference, 'utf8')).running).toBe(true);
    await win.getByRole('button', { name: 'Gesamten Codex-Dienst stoppen …', exact: true }).click();
    await win.getByRole('alertdialog').getByRole('button', { name: 'Dienst stoppen', exact: true }).click();
    await expect(win.locator('.codex-smartphone-status')).toContainText('Dienst gestoppt');
    await win.getByRole('button', { name: 'Dienst starten / erneut verbinden', exact: true }).click();
    await expect(win.locator('.codex-smartphone-status')).toContainText('Remote-Dienst verbunden');
    await win.screenshot({ path: join(tmpdir(), 'dmws-smartphone-settings-de.png') });
    expect(await win.evaluate(async () => { try { await window.api.codexRemote('invalid' as 'status'); return 'accepted'; } catch { return 'rejected'; } })).toBe('rejected');
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
