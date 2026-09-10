import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

function envFor(dir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, DMWS_USERDATA: dir, DMWS_DISABLE_WEBGL: '1' };
  delete env.DMWS_E2E;
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

test('corrupt startup reports its backup and exits before creating a window or touching history', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-corrupt-start-'));
  const bytes = Buffer.from('{"workspaces":[{"name":"Keep this project"}');
  const history = '{"p99":"KEEP EXISTING TERMINAL HISTORY"}';
  const notice = join(dir, 'notice.json');
  const entry = join(dir, 'probe.cjs');
  writeFileSync(join(dir, 'state.json'), bytes);
  writeFileSync(join(dir, 'scrollback.json'), history);
  // Capture the native dialog at its API boundary without leaving a blocking
  // modal on the CI desktop. The actual app startup and quit paths run intact.
  writeFileSync(entry, `
    const { app, dialog } = require('electron');
    const fs = require('node:fs');
    dialog.showMessageBox = async options => {
      fs.writeFileSync(${JSON.stringify(notice)}, JSON.stringify(options));
      return { response: 0, checkboxChecked: false };
    };
    app.on('browser-window-created', () => {
      fs.writeFileSync(${JSON.stringify(join(dir, 'unexpected-window'))}, 'created');
      setTimeout(() => app.exit(3), 100);
    });
    setTimeout(() => app.exit(2), 10000).unref();
    require(${JSON.stringify(resolve('out/main/index.js'))});
  `);
  try {
    const binary = createRequire(resolve('package.json'))('electron') as string;
    const child = spawn(binary, [entry, '--lang=en-US'], { env: envFor(dir), stdio: 'ignore' });
    const code = await new Promise<number | null>((res, rej) => {
      child.once('error', rej);
      child.once('exit', res);
    });
    expect(code).toBe(0);
    expect(readdirSync(dir)).not.toContain('unexpected-window');
    const options = JSON.parse(readFileSync(notice, 'utf8')) as { detail: string; type: string };
    expect(options.type).toBe('error');
    const backup = readdirSync(dir).find(name => name.startsWith('state.json.corrupt-'))!;
    expect(options.detail).toContain(join(dir, backup));
    expect(readFileSync(join(dir, backup))).toEqual(bytes);
    expect(readFileSync(join(dir, 'state.json'))).toEqual(bytes);
    expect(readFileSync(join(dir, 'scrollback.json'), 'utf8')).toBe(history);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BOM configuration opens the existing workspace normally', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmws-bom-start-'));
  writeFileSync(join(dir, 'state.json'), '\uFEFF' + JSON.stringify({
    version: 1, activeWorkspaceId: 'w42',
    workspaces: [{ id: 'w42', name: 'Preserved BOM project', cwd: dir, layout: null }],
    settings: { locale: 'en', themeId: 'default', terminalOpacity: 0.95 }
  }));
  const app = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: envFor(dir) as Record<string, string> });
  try {
    const window = await app.firstWindow();
    await expect(window.getByText('Preserved BOM project').first()).toBeVisible();
    expect(readdirSync(dir).filter(name => name.includes('.corrupt-'))).toEqual([]);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
