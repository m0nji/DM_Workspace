import { test, expect, _electron as electron } from '@playwright/test';

// Stuck private modes are the "pane can no longer scroll" bug: a TUI that dies
// uncleanly (or a poisoned scrollback restore) leaves mouse tracking on —
// hijacking the wheel and text selection — or the alternate screen active,
// where there is no scrollback and the wheel pages through shell history via
// arrow-key emulation. Two defenses are covered here:
//
//  - Automatic: the DMWS prompt marker (emitted by the local shell integration
//    with every prompt) proves no full-screen program owns the terminal, so any
//    still-active mouse tracking / alt screen is stale and is reset on the spot.
//  - Manual: the "Reset terminal" context-menu action, for rescuing a pane
//    while a program still holds the terminal (no prompt in sight).
//
// The stuck state is injected with the __termWrite e2e hook (renderer-side
// term.write) — the same path a bad restore takes, and the only reliable one:
// ConPTY on Windows swallows mouse-tracking DECSETs coming through the shell.
// A foreground `sleep` suppresses the prompt (and with it the automatic reset)
// for as long as the test needs the stuck state to persist; `sleep` works in
// PowerShell (Start-Sleep alias) and POSIX shells alike. Active mouse tracking
// is observable via xterm's `enable-mouse-events` class, the buffer type via
// the __bufferTypes hook.

type Win = Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>;

async function launchWithPane() {
  const app = await electron.launch({
    // --lang pins the Chromium UI locale (and with it navigator.language, which
    // resolveLocale reads) to English, so the spec's texts match on German
    // systems too — the CI runner is English either way.
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  const screen = win.locator('.pane .xterm-screen').first();
  await screen.waitFor();
  await win.waitForTimeout(1500); // let the shell spawn + print its prompt
  return { app, win, screen };
}

const mouseTrackingOn = (win: Win) => () =>
  win.evaluate(() => document.querySelectorAll('.enable-mouse-events').length > 0);

const bufferType = (win: Win) => () =>
  win.evaluate(() => {
    const types = (window as unknown as { __bufferTypes: Map<string, () => string> }).__bufferTypes;
    return [...types.values()][0]();
  });

// Inject raw escapes on the renderer side, exactly like a poisoned restore.
const inject = (win: Win, data: string) =>
  win.evaluate((d) => {
    const writes = (window as unknown as { __termWrite: Map<string, (data: string) => void> }).__termWrite;
    [...writes.values()][0](d);
  }, data);

// Keep a foreground command running so no prompt (= no automatic reset) fires
// while the test needs the stuck state; injection happens during the sleep.
async function holdShell(win: Win, screen: Awaited<ReturnType<typeof launchWithPane>>['screen'], seconds: number): Promise<void> {
  await screen.click();
  await win.keyboard.type(`sleep ${seconds}`);
  await win.keyboard.press('Enter');
}

test('stuck mouse tracking is cleared automatically at the next shell prompt', async () => {
  const { app, win, screen } = await launchWithPane();

  await holdShell(win, screen, 3);
  await inject(win, '\x1b[?1003h');
  await expect.poll(mouseTrackingOn(win)).toBe(true);

  // No context menu, no user action: the prompt after the sleep heals the pane.
  await expect.poll(mouseTrackingOn(win)).toBe(false);

  await app.close();
});

test('a stuck alternate screen is left automatically at the next shell prompt', async () => {
  const { app, win, screen } = await launchWithPane();

  await expect.poll(bufferType(win)).toBe('normal');
  await holdShell(win, screen, 3);
  await inject(win, '\x1b[?1049h');
  await expect.poll(bufferType(win)).toBe('alternate');

  await expect.poll(bufferType(win)).toBe('normal');

  await app.close();
});

test('"Reset terminal" clears stuck mouse tracking while a command still runs', async () => {
  const { app, win, screen } = await launchWithPane();

  // The long sleep means no prompt fires: only the manual context-menu reset
  // can recover the pane — the rescue path for a wedged TUI that still runs.
  await holdShell(win, screen, 30);
  await inject(win, '\x1b[?1000h');
  await expect.poll(mouseTrackingOn(win)).toBe(true);

  await screen.click({ button: 'right' });
  await win.getByText('Reset terminal').click();

  // Mouse tracking is cleared — the pane is usable again. (Reset never calls
  // term.clear(), so the buffer is preserved by construction; only "Clear
  // window" wipes it.)
  await expect.poll(mouseTrackingOn(win)).toBe(false);

  await app.close();
});

test('"Reset terminal" leaves a stuck alternate screen while a command still runs', async () => {
  const { app, win, screen } = await launchWithPane();

  await expect.poll(bufferType(win)).toBe('normal');
  await holdShell(win, screen, 30);
  await inject(win, '\x1b[?1049h');
  await expect.poll(bufferType(win)).toBe('alternate');

  await screen.click({ button: 'right' });
  await win.getByText('Reset terminal').click();

  // Back on the normal buffer: the scrollback (and the wheel) work again.
  await expect.poll(bufferType(win)).toBe('normal');

  await app.close();
});
