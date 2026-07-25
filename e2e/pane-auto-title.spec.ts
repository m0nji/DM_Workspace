import { test, expect, _electron as electron } from '@playwright/test';
import { basename } from 'node:path';

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
  const command = 'node -e "setTimeout(()=>{},10000)"';
  await win.keyboard.type(command);
  await win.keyboard.press('Enter');

  const automatic = pane.locator('.pane-label.automatic');
  await expect(automatic).toBeVisible();
  await expect(automatic).toHaveText(command);

  // Ctrl+C ends Node; the LOCAL shell hook emits the next prompt marker and
  // removes the now-finished automatic title.
  await win.keyboard.press('Control+C');
  await expect(automatic).toHaveCount(0);

  // Recall the same long-running command through the shell's own history and
  // submit it again. The tracker cannot reconstruct history-expanded text, so
  // it must fail closed: once Enter starts the command, subsequent interactive
  // input must never be mistaken for a new shell command/title.
  await win.keyboard.press('ArrowUp');
  await win.keyboard.press('Enter');
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

  // Start a program that holds the terminal and reads a line. It prints the
  // old, unauthenticated marker first — exactly what an attacker who read the
  // source would send. Submitting the command disarms the tracker; only a
  // genuine local prompt may re-arm it.
  const command = `printf '\\033]777;dmws-prompt\\007'; cat > /dev/null`;
  await win.keyboard.type(command);
  await win.keyboard.press('Enter');

  const automatic = pane.locator('.pane-label.automatic');
  await expect(automatic).toHaveText(command);

  await win.keyboard.type('hunter2-must-not-be-a-title');
  await win.keyboard.press('Enter');
  // Give a title change time to land before asserting it did not.
  await win.waitForTimeout(600);

  // The title is still the command the user actually ran, not the secret typed
  // into the program that is holding the terminal.
  await expect(automatic).toHaveText(command);

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
