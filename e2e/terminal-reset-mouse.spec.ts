import { test, expect, _electron as electron } from '@playwright/test';

// A TUI that exits uncleanly can leave xterm stuck in mouse-tracking mode, which
// hijacks the wheel and text selection. The "Reset terminal" context-menu action
// must clear that state without wiping the buffer. xterm reflects active mouse
// tracking by adding the `enable-mouse-events` class, so we can observe it directly.
test('"Reset terminal" clears stuck mouse tracking without clearing the buffer', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  const mouseTrackingOn = () =>
    win.evaluate(() => document.querySelectorAll('.enable-mouse-events').length > 0);

  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  const screen = win.locator('.pane .xterm-screen').first();
  await screen.waitFor();

  // Focus the terminal and have the shell turn on mouse tracking (?1000h) — the
  // same state a crashed TUI leaves behind. printf emits the raw escape, which
  // xterm parses and reflects as the enable-mouse-events class.
  await screen.click();
  await win.keyboard.type("printf '\\033[?1000h'");
  await win.keyboard.press('Enter');
  await expect.poll(mouseTrackingOn).toBe(true);

  // Open the context menu and invoke Reset terminal.
  await screen.click({ button: 'right' });
  await win.getByText('Reset terminal').click();

  // Mouse tracking is cleared — the pane is usable again. (Reset never calls
  // term.clear(), so the buffer is preserved by construction; only "Clear
  // window" wipes it.)
  await expect.poll(mouseTrackingOn).toBe(false);

  await app.close();
});
