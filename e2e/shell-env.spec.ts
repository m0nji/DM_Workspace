import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Simulate a GUI launch: a minimal PATH WITHOUT /opt/homebrew/bin, like macOS
// gives a Finder/Spotlight-launched .app. The login shell (-l) must re-add the
// Homebrew path via path_helper so `codex` is found again.
const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-env-'));

test('login shell restores PATH (codex found) and reports 256-color TERM', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      HOME: process.env.HOME as string,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin', // minimal, NO homebrew
      DMWS_USERDATA: USERDATA
    }
  });
  const win = await app.firstWindow();
  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();
  await win.waitForTimeout(1500);

  await win.locator('.pane .xterm-screen').first().click();
  await win.keyboard.type('echo "TERM=$TERM COLORTERM=$COLORTERM"; which codex');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);

  const text = await win.locator('.xterm-rows').first().innerText();
  console.log('--- terminal ---\n' + text + '\n--- end ---');

  // The resolved codex path proves the login shell re-added /opt/homebrew/bin.
  expect(text).toContain('TERM=xterm-256color');
  expect(text).toContain('COLORTERM=truecolor');
  expect(text).toContain('/opt/homebrew/bin/codex');

  await app.close();
});
