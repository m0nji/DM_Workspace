import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { waitForShellPrompt, waitForScrollbackOnDisk, paneBufferText } from './wait-helpers';

// Verifies that terminal scrollback is replayed after an app restart.
// Both launches share an explicit userData dir (DMWS_USERDATA) so the second
// launch sees the first launch's persisted layout + scrollback.json.
const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-restart-'));
const MARKER = 'SCROLLBACK_MARKER_4242';

// DMWS_E2E stays ON for the __bufferText hook (the restored history lives in the
// scrollback, which .xterm-rows does not render). DMWS_USERDATA still decides the
// userData path, so restart persistence is unaffected — see main/index.ts.
function launchEnv(): Record<string, string> {
  return { ...process.env, DMWS_USERDATA: USERDATA, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' } as Record<string, string>;
}

test('scrollback is replayed after a restart', async () => {
  // ---- Launch 1: create a single pane and run a command ----
  const app1 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win1 = await app1.firstWindow();
  await expect(win1.getByText('How many terminals do you want to open?')).toBeVisible();
  await win1.getByText('1 Pane').click();
  await expect(win1.locator('.pane .xterm-screen').first()).toBeVisible();
  await waitForShellPrompt(win1);

  await win1.locator('.pane .xterm-screen').first().click();
  await win1.keyboard.type(`echo ${MARKER}`);
  await win1.keyboard.press('Enter');
  await expect(win1.locator('.xterm-rows').first()).toContainText(MARKER);
  // Closing before the save lands would leave launch 2 nothing to restore.
  await waitForScrollbackOnDisk(USERDATA, MARKER);
  await app1.close();

  // ---- Launch 2: same userData → layout + scrollback restored ----
  const app2 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win2 = await app2.firstWindow();
  // Layout restores straight to a pane (no welcome screen).
  await expect(win2.locator('.pane .xterm-screen').first()).toBeVisible();
  // Reaching this point now genuinely means the SHELL has printed. The replayed
  // history is parked in the scrollback, so the viewport stays blank until the
  // shell writes into it. Before that parking the history itself filled the
  // viewport, so this wait was satisfied ~150ms too early — and the assertions
  // below ran in the gap before the shell erased the screen (ESC[2J ESC[H on
  // PowerShell) and took the history with it. Green test, wiped history.
  await waitForShellPrompt(win2);

  await win2.screenshot({ path: join(USERDATA, 'restored.png') });
  console.log('USERDATA=' + USERDATA);

  // Assert on the whole buffer, not the viewport: parked history is off-screen
  // by design, so .xterm-rows would show none of it.
  const text = await paneBufferText(win2);
  console.log('--- restored terminal buffer ---\n' + text + '\n--- end ---');
  expect(text).toContain(MARKER);
  await expect(win2.getByRole('status')).toContainText('History restored. This is a new shell; previous programs were not resumed.');
  await app2.close();
});
