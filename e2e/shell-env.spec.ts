import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Simulate a GUI launch: a minimal four-entry PATH, like macOS gives a
// Finder/Spotlight-launched .app. The login shell (-l) must re-run the user's
// profile and path_helper so tools outside /usr/bin are reachable again.
const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-env-'));

// POSIX-only: der Test tippt ein Shell-Kommando mit printf/tr/grep und prüft die
// Wirkung von `-l` (Login-Shell). Auf Windows startet die App PowerShell (siehe
// defaultShell in pty-manager.ts), die weder die Syntax noch das -l-Konzept kennt
// — der Test konnte dort nie grün werden und war schlicht dauerhaft rot.
test.skip(process.platform === 'win32', 'POSIX-Login-Shell-Verhalten; Windows startet PowerShell');

test('login shell restores the full PATH and reports 256-color TERM', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: {
      HOME: process.env.HOME as string,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin', // minimal, NO homebrew
      DMWS_USERDATA: USERDATA,
      DMWS_DISABLE_WEBGL: '1'
    }
  });
  const win = await app.firstWindow();
  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();
  await win.waitForTimeout(1500);

  await win.locator('.pane .xterm-screen').first().click();
  // PATHN counts the entries the shell ended up with. We injected exactly four
  // (/usr/bin:/bin:/usr/sbin:/sbin), so anything above that proves the login
  // shell re-ran the user's profile and restored the fuller PATH. Asserting the
  // count rather than a specific install location keeps this independent of
  // where any given tool happens to live on the machine — the previous version
  // hardcoded /opt/homebrew/bin/codex and broke when codex moved to ~/.local/bin.
  await win.keyboard.type('echo "TERM=$TERM COLORTERM=$COLORTERM"; echo "PATHN=$(printf %s \\"$PATH\\" | tr : \'\\n\' | grep -c .)"');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);

  const text = await win.locator('.xterm-rows').first().innerText();
  console.log('--- terminal ---\n' + text + '\n--- end ---');

  expect(text).toContain('TERM=xterm-256color');
  expect(text).toContain('COLORTERM=truecolor');
  const pathn = text.match(/PATHN=(\d+)/);
  expect(pathn, `no PATHN in terminal output:\n${text}`).not.toBeNull();
  expect(Number(pathn![1])).toBeGreaterThan(4);

  await app.close();
});
