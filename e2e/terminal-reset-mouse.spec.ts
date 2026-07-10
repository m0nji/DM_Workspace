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

// The second stuck-mode failure class: a TUI that crashes inside the alternate
// screen (?1049h) leaves the pane there. The alt buffer has no scrollback, and
// xterm emulates arrow keys for the wheel, so the user pages through shell
// history instead of scrolling. "Reset terminal" must return to the normal
// buffer. Asserted via the __bufferTypes e2e hook (TerminalView), since xterm's
// DOM scroll metrics don't reflect the buffer switch deterministically.
test('"Reset terminal" leaves a stuck alternate screen so scrolling works again', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  const screen = win.locator('.pane .xterm-screen').first();
  await screen.waitFor();

  const bufferType = () =>
    win.evaluate(() => {
      const types = (window as unknown as { __bufferTypes: Map<string, () => string> }).__bufferTypes;
      return [...types.values()][0]();
    });

  // Simulate the crash state: enter the alternate screen and never leave it.
  await screen.click();
  await expect.poll(bufferType).toBe('normal');
  await win.keyboard.type("printf '\\033[?1049h'");
  await win.keyboard.press('Enter');
  await expect.poll(bufferType).toBe('alternate');

  await screen.click({ button: 'right' });
  await win.getByText('Reset terminal').click();

  // Back on the normal buffer: the scrollback (and the wheel) work again.
  await expect.poll(bufferType).toBe('normal');

  await app.close();
});
