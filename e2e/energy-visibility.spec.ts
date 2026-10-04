import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// A native child process preserves real visibility changes. Playwright's CDP
// foreground emulation otherwise keeps document.hidden false after minimize.
test('minimizing releases graphics but preserves terminals and background output', async () => {
  test.setTimeout(60000);
  const electronPath = createRequire(resolve('package.json'))('electron') as string;
  const env: NodeJS.ProcessEnv = { ...process.env, DMWS_USERDATA: '', DMWS_E2E: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const child = spawn(electronPath, [resolve('e2e/fixtures/energy-visibility.cjs'), '--lang=en-US'], { env });
  let output = '';
  child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
  try {
    const code = await new Promise<number | null>((resolveExit, reject) => {
      const timer = setTimeout(() => reject(new Error(`Native visibility test timed out:\n${output}`)), 55000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); resolveExit(code); });
    });
    expect(code, output).toBe(0);
    expect(output).toContain('ENERGY_VISIBILITY_OK');
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
});
