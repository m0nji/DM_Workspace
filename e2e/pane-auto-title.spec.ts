import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { basename } from 'node:path';
import { paneBufferText } from './wait-helpers';

// The long-running command this spec interrupts. It ANNOUNCES itself before it
// goes to sleep, because Ctrl+C only interrupts a program that already holds the
// terminal: between "the shell accepted the line" and "the child process is
// attached to the console" the interrupt is swallowed — measured on Windows
// (ConPTY) as 6 lost out of 8 when the key is pressed straight after Enter.
//
// With the interrupt lost, the title used to clear anyway — because the sleeping
// node ended BY ITSELF. The old command slept 10s and the assertion's budget is
// 10s, so the test was a coin flip against a ~10.06s self-exit: green on an idle
// machine, red in a full parallel run. The sleep is therefore now longer than
// every timeout in play (expect 10s, test 30s): a swallowed Ctrl+C can no longer
// be papered over by the program ending on its own, it fails the test.
const RUNNING = 'RUNNING';
const SLEEP_COMMAND = `node -e "console.log('${RUNNING}');setTimeout(()=>{},30000)"`;

// Wait for the shell to reach a state the test needs, read from the pane's
// buffer. Deliberately not from the DOM: this pane runs the WebGL renderer, and
// there xterm paints into a canvas — `.xterm-rows`, which wait-helpers'
// waitForShellPrompt inspects, does not exist at all (only the specs that launch
// with DMWS_DISABLE_WEBGL can use that helper).
async function waitForBuffer(
  win: Page, ready: (text: string) => boolean, label: string, timeoutMs = 20000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (ready(await paneBufferText(win))) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

// How often the marker stands on a line of its OWN — i.e. how often the program
// actually ran and printed it. A substring search would also match the echoed
// command line, which carries the marker inside console.log(...), and would
// prove nothing about the process.
function outputLines(text: string, marker: string): number {
  return text.split('\n').filter((line) => line.trim() === marker).length;
}

test('shows the active shell command and clears it when the prompt returns', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  const pane = win.locator('.pane').first();
  const screen = pane.locator('.xterm-screen');
  await screen.waitFor();

  await screen.click();
  // Typing before the first prompt queues the bytes in the PTY, and the title
  // then only appears once the shell finally prompts — under load later than the
  // assertion below allows.
  await waitForBuffer(win, (text) => text.trim().length > 0, 'the first shell prompt');
  await win.keyboard.type(SLEEP_COMMAND);
  await win.keyboard.press('Enter');

  const automatic = pane.locator('.pane-label.automatic');
  await expect(automatic).toBeVisible();
  await expect(automatic).toHaveText(SLEEP_COMMAND);

  // Ctrl+C ends Node; the LOCAL shell hook emits the next prompt marker and
  // removes the now-finished automatic title. Wait for the command's own output
  // first: only then is it holding the terminal and does the interrupt arrive.
  await waitForBuffer(win, (text) => outputLines(text, RUNNING) >= 1, `the running command's ${RUNNING} line`);
  await win.keyboard.press('Control+C');
  await expect(automatic).toHaveCount(0);

  // Recall the same long-running command through the shell's own history and
  // submit it again. The tracker cannot reconstruct history-expanded text, so
  // it must fail closed: once Enter starts the command, subsequent interactive
  // input must never be mistaken for a new shell command/title.
  await win.keyboard.press('ArrowUp');
  await win.keyboard.press('Enter');
  // Again: the text below is meant to be typed INTO the running command, so wait
  // until it is running. Otherwise it would land in the shell's line editor and
  // the assertion would hold for the wrong reason.
  await waitForBuffer(win, (text) => outputLines(text, RUNNING) >= 2, `the recalled command's ${RUNNING} line`);
  await win.keyboard.type('must-not-be-pane-title');
  await win.keyboard.press('Enter');
  await expect(automatic).toHaveCount(0);

  await win.keyboard.press('Control+C');

  await app.close();
});

// The prompt marker is what arms title capture, and it is plain bytes in the
// output stream. When it was a fixed public string, anything that could WRITE
// to the terminal — a malicious CLI, or the remote end of an ssh session —
// could print it while holding the terminal and re-arm capture, so the next
// line the user typed (a password at a faked prompt) became the pane title and,
// with notifications on, the body of an OS notification. The marker now carries
// a per-launch nonce that terminal output cannot know.
test('a forged prompt marker printed by a running program does not capture the next input', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.getByText('1 Pane').click();
  const pane = win.locator('.pane').first();
  const screen = pane.locator('.xterm-screen');
  await screen.waitFor();
  await screen.click();
  await waitForBuffer(win, (text) => text.trim().length > 0, 'the first shell prompt');

  // Start a program that holds the terminal and swallows what is typed into it.
  // It prints the old, unauthenticated marker first — exactly what an attacker
  // who read the source would send. Submitting the command disarms the tracker;
  // only a genuine local prompt may re-arm it. Written with node rather than
  // printf/cat so it runs under PowerShell on Windows too. The visible HOLDING
  // that follows the marker is the test's proof that the program got that far:
  // the marker itself is swallowed by the terminal's OSC parser and leaves no
  // trace on screen.
  const command = 'node -e "process.stdout.write(\'\\u001b]777;dmws-prompt\\u0007HOLDING\\n\'); process.stdin.resume()"';
  await win.keyboard.type(command);
  await win.keyboard.press('Enter');

  // Matched by substring: a title longer than the header allows is shortened
  // with an ellipsis, and this command is.
  const automatic = pane.locator('.pane-label.automatic');
  await expect(automatic).toContainText('node -e');

  // The secret below has to be typed INTO that program. Without this wait it can
  // land in the shell's line editor instead, and the assertion would hold for a
  // reason that has nothing to do with the forged marker.
  await waitForBuffer(win, (text) => outputLines(text, 'HOLDING') >= 1, 'the forging program to hold the terminal');
  await win.keyboard.type('hunter2-must-not-be-a-title');
  await win.keyboard.press('Enter');
  // Give a title change time to land before asserting it did not.
  await win.waitForTimeout(600);

  // The title is still the command the user actually ran, not the secret typed
  // into the program that is holding the terminal.
  await expect(automatic).toContainText('node -e');
  await expect(automatic).not.toContainText('hunter2');

  await win.keyboard.press('Control+C');
  await app.close();
});

test('collapses the folder to its last segment when the pane becomes narrow', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.setViewportSize({ width: 1200, height: 760 });

  const folder = process.cwd();
  await win.evaluate((cwd) => {
    const store = (window as unknown as {
      __store: { setState: (patch: unknown) => void };
    }).__store;
    store.setState({
      workspaces: [{
        id: 'w1', name: 'Workspace 1', cwd,
        layout: { type: 'pane', id: 'responsive-title-pane' },
        paneTitles: { 'responsive-title-pane': 'Codex · Responsive panel titles' }
      }],
      activeWorkspaceId: 'w1'
    });
  }, folder);

  const pane = win.locator('.pane').first();
  const full = pane.locator('.pane-title-full');
  const short = pane.locator('.pane-title-short');
  await expect(full).toBeVisible();
  await expect(full).toHaveText(folder);
  await expect(short).toBeHidden();

  await win.setViewportSize({ width: 680, height: 760 });
  await expect(full).toBeHidden();
  await expect(short).toBeVisible();
  await expect(short).toHaveText(basename(folder));
  await expect(pane.locator('.pane-label')).toHaveText('Codex · Responsive panel titles');

  await app.close();
});
