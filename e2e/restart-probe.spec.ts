import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  waitForShellPrompt,
  waitForScrollbackOnDisk,
  waitForScrollbackRewrite,
  scrollbackMtime,
  paneBufferText
} from './wait-helpers';

const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-probe-'));
const MARKER = 'PROBE_MARK_77';

// DMWS_E2E stays ON for the __bufferText hook; DMWS_USERDATA still decides the
// userData path, so the restarts still share one profile (main/index.ts).
function env(): Record<string, string> {
  return { ...process.env, DMWS_USERDATA: USERDATA, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' } as Record<string, string>;
}

test('restore notice stays singular across restarts and never appears on a fresh pane', async () => {
  // Launch 1: one pane, one command.
  const a1 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: env() });
  const w1 = await a1.firstWindow();
  await w1.getByText('1 Pane').click();
  await expect(w1.locator('.pane .xterm-screen').first()).toBeVisible();
  await waitForShellPrompt(w1);
  await w1.locator('.pane .xterm-screen').first().click();
  await w1.keyboard.type(`echo ${MARKER}`);
  await w1.keyboard.press('Enter');
  await expect(w1.locator('.xterm-rows').first()).toContainText(MARKER);
  await waitForScrollbackOnDisk(USERDATA, MARKER);
  await a1.close();

  // Launch 2: restore with one UI notice.
  const savedAfterLaunch1 = scrollbackMtime(USERDATA);
  const a2 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: env() });
  const w2 = await a2.firstWindow();
  await expect(w2.locator('.pane .xterm-screen').first()).toBeVisible();
  await waitForShellPrompt(w2);
  // The restored buffer is re-saved without the UI notice; launch 3 must
  // read THAT version, so wait for the
  // file to be rewritten rather than for a fixed span.
  await waitForScrollbackRewrite(USERDATA, savedAfterLaunch1);
  await a2.close();

  // Launch 3: restore again. Still one notice, and the marker remains present.
  const a3 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: env() });
  const w3 = await a3.firstWindow();
  await expect(w3.locator('.pane .xterm-screen').first()).toBeVisible();
  await waitForShellPrompt(w3);
  // The whole buffer, not the viewport: replayed history is parked in the
  // scrollback so the shell's opening repaint cannot reach it.
  const text = await paneBufferText(w3);
  console.log('--- after 2 restarts ---\n' + text + '\n--- end ---');
  expect(text).toContain(MARKER);
  await expect(w3.getByRole('status').filter({ hasText: 'History restored.' })).toHaveCount(1);
  expect(text).not.toContain('History restored.');

  // Probe: add a brand-new pane (split) — it has no saved scrollback, so exactly
  // one of the two panes must show the restored history and the other must be clean.
  await w3.locator('.pane').first().hover();
  await w3.locator('.pane .pane-btn[title="Split into left & right"]').first().click();
  await expect(w3.locator('.pane')).toHaveCount(2);
  await w3.waitForTimeout(1200);
  const paneTexts: string[] = [];
  for (let i = 0; i < 2; i++) {
    paneTexts.push(await paneBufferText(w3, i));
  }
  console.log('--- pane 0 ---\n' + paneTexts[0] + '\n--- pane 1 ---\n' + paneTexts[1] + '\n--- end ---');
  const withMarker = paneTexts.filter((t) => t.includes(MARKER)).length;
  await expect(w3.locator('.pane').filter({ has: w3.getByRole('status').filter({ hasText: 'History restored.' }) })).toHaveCount(1);
  expect(withMarker).toBe(1);

  await a3.close();
  console.log('USERDATA=' + USERDATA);
});
