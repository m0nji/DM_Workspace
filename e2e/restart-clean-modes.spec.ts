import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The recurring "restored session can no longer scroll" bug: saves written
// while a TUI held the terminal used to embed the live DECSET modes and the
// active alternate-screen frame (SerializeAddon appends both unless excluded),
// and the next launch replayed them into the fresh pane — which then started
// inside the alt screen (no scrollback) with mouse tracking hijacking the
// wheel. Every app update/restart during a live agent session re-poisoned the
// pane, on macOS and Windows alike.
//
// This covers both defenses end to end:
//  1. New saves are clean: a save taken while the pane sits stuck in the alt
//     screen with mouse tracking on must persist plain content, no modes.
//  2. Old poisoned files are healed: a save carrying the old format's mode
//     tail (hand-appended below) must restore to a normal-buffer pane without
//     mouse tracking, history intact.
//
// The stuck state is injected renderer-side via the __termWrite hook — the
// same path a poisoned restore takes (ConPTY on Windows swallows mouse
// DECSETs coming through the shell, so the PTY can't create it). Filler lines
// push the marker into the scrollback: on Windows, ConPTY wipes the visible
// viewport rows when the fresh shell attaches after a restore, so only
// scrolled-out history survives — which is also why the restore separator
// (bottom of the viewport) can't be asserted here; restart-probe.spec covers
// it on POSIX. History is asserted via the __bufferText hook rather than the
// DOM for the same reason.
const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-restart-cleanmodes-'));
const MARKER = 'CLEAN_MODES_MARKER_1337';

function launchEnv(): Record<string, string> {
  // DMWS_USERDATA (persistence across both launches) wins over DMWS_E2E's
  // throwaway temp dir; DMWS_E2E stays set for the renderer e2e hooks.
  return {
    ...process.env, DMWS_USERDATA: USERDATA, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1'
  } as Record<string, string>;
}

test('a pane stuck in a TUI at quit time restores scrollable', async () => {
  // ---- Launch 1: leave the pane wedged in the alt screen with mouse tracking ----
  const app1 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win1 = await app1.firstWindow();
  await win1.getByText('How many terminals do you want to open?').waitFor();
  await win1.getByText('1 Pane').click();
  await win1.locator('.pane .xterm-screen').first().waitFor();
  await win1.waitForTimeout(1500); // let the shell spawn + print its prompt

  await win1.locator('.pane .xterm-screen').first().click();
  await win1.keyboard.type(`echo ${MARKER}`);
  await win1.keyboard.press('Enter');
  await win1.waitForTimeout(500); // marker output lands in the buffer
  // Filler scrolls the marker out of the viewport (see header comment), then
  // the pane enters the stuck state a wedged TUI leaves behind.
  await win1.evaluate(() => {
    const writes = (window as unknown as { __termWrite: Map<string, (data: string) => void> }).__termWrite;
    const write = [...writes.values()][0];
    write('\r\n'.repeat(60));
    write('\x1b[?1003h\x1b[?1049h');
  });
  // Typing echoes through the PTY, which is what schedules a save — the save
  // itself then runs with the pane still stuck in the alt screen.
  await win1.keyboard.type('rem');
  await win1.waitForTimeout(3000); // renderer save (1s debounce) + store flush (1s)

  // Defense 1 — the persisted scrollback carries content but no set/reset modes.
  const file = join(USERDATA, 'scrollback.json');
  const duringStuck = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  const entries = Object.values(duringStuck);
  expect(entries.some((v) => v.includes(MARKER))).toBe(true);
  for (const v of entries) {
    expect(v).not.toMatch(/\x1b\[[0-9;?]*[hl]/);
  }
  await app1.close();

  // ---- Poison the file the way app versions ≤ 0.9.30 did: alt-screen frame
  // plus a modes tail appended to the content (re-read: the quit flush wrote a
  // newer save than the one asserted above). ----
  const saved = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
  const poisoned: Record<string, string> = {};
  for (const [k, v] of Object.entries(saved)) {
    poisoned[k] = `${v}\x1b[?1049h\x1b[Hdead TUI frame\x1b[?1003h\x1b[?2004h\x1b[?1004h`;
  }
  writeFileSync(file, JSON.stringify(poisoned), 'utf8');

  // ---- Launch 2: the restored pane must be scrollable — normal buffer, no
  // mouse tracking, history intact. ----
  const app2 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win2 = await app2.firstWindow();
  await win2.locator('.pane .xterm-screen').first().waitFor();
  await win2.waitForTimeout(1500);

  const bufferType = () =>
    win2.evaluate(() => {
      const types = (window as unknown as { __bufferTypes: Map<string, () => string> }).__bufferTypes;
      return [...types.values()][0]();
    });
  const mouseTrackingOn = () =>
    win2.evaluate(() => document.querySelectorAll('.enable-mouse-events').length > 0);
  const bufferText = () =>
    win2.evaluate(() => {
      const texts = (window as unknown as { __bufferText: Map<string, () => string> }).__bufferText;
      return [...texts.values()][0]();
    });

  await expect.poll(bufferType).toBe('normal');
  await expect.poll(mouseTrackingOn).toBe(false);
  await expect.poll(bufferText).toContain(MARKER);

  await app2.close();
});
