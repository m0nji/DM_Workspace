import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Verifies that terminal scrollback is replayed after an app restart.
// Both launches share an explicit userData dir (DMWS_USERDATA) so the second
// launch sees the first launch's persisted layout + scrollback.json.
const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-restart-'));
const MARKER = 'SCROLLBACK_MARKER_4242';

function launchEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env, DMWS_USERDATA: USERDATA, DMWS_DISABLE_WEBGL: '1' } as Record<string, string>;
  delete env.DMWS_E2E;
  return env;
}

test('scrollback is replayed after a restart', async () => {
  // ---- Launch 1: create a single pane and run a command ----
  const app1 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win1 = await app1.firstWindow();
  await expect(win1.getByText('How many terminals do you want to open?')).toBeVisible();
  await win1.getByText('1 Pane').click();
  await expect(win1.locator('.pane .xterm-screen').first()).toBeVisible();
  await win1.waitForTimeout(1500); // let the shell spawn + print its prompt

  await win1.locator('.pane .xterm-screen').first().click();
  await win1.keyboard.type(`echo ${MARKER}`);
  await win1.keyboard.press('Enter');
  await win1.waitForTimeout(1800); // echo output renders + debounced (1s) save fires

  await expect(win1.locator('.xterm-rows').first()).toContainText(MARKER);
  await app1.close();

  // ---- Launch 2: same userData → layout + scrollback restored ----
  const app2 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win2 = await app2.firstWindow();
  // Layout restores straight to a pane (no welcome screen).
  await expect(win2.locator('.pane .xterm-screen').first()).toBeVisible();
  await win2.waitForTimeout(1500);

  const text = await win2.locator('.xterm-rows').first().innerText();
  console.log('--- restored terminal text ---\n' + text + '\n--- end ---');
  await win2.screenshot({ path: join(USERDATA, 'restored.png') });
  console.log('USERDATA=' + USERDATA);

  await expect(win2.locator('.xterm-rows').first()).toContainText(MARKER);
  await expect(win2.locator('.xterm-rows').first()).toContainText('wiederhergestellt');
  await app2.close();
});
