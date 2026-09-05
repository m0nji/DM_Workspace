import { test, expect, _electron as electron } from '@playwright/test';
import { waitForShellPrompt } from './wait-helpers';

// The two promises the pane-swap feature is built on — neither can be checked in
// vitest (node environment, no DOM, no .tsx):
//
//  1. Dragging a pane onto another MOVES both terminals to their new places. A
//     remount would restart the pane and replay the serialized scrollback under
//     the running program (same failure mode as e2e/pane-split-keeps-terminal).
//  2. Mod+Shift+Arrow moves the DOM focus along with the highlight, so the next
//     keystroke goes to the NEWLY focused terminal — without focusTerminal only
//     the frame would move while typing stayed in the old pane.
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

test('swapping panes moves the terminals, and the focus shortcut takes typing along', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    // DOM renderer so terminal text is readable from .xterm-rows.
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('2 side by side').click();
  await expect(win.locator('.pane')).toHaveCount(2);
  await waitForShellPrompt(win, 0);
  await waitForShellPrompt(win, 1);

  const rows = (i: number) => win.locator('.pane').nth(i).locator('.xterm-rows');

  // A distinct marker per terminal — that is what identifies a terminal after
  // it has been moved somewhere else.
  for (const i of [0, 1]) {
    await win.locator('.pane').nth(i).locator('.xterm-screen').click();
    await win.keyboard.type(`echo SWAP_PROBE_${i}`);
    await win.keyboard.press('Enter');
    await expect(rows(i)).toContainText(`SWAP_PROBE_${i}\n`);
  }

  // Tag both live xterm hosts. A remount builds a fresh host and the tag is gone.
  await win.evaluate(() => {
    document.querySelectorAll('.pane .xterm-host')
      .forEach((host, i) => host.setAttribute('data-probe', `alive-${i}`));
  });

  // Drag the left pane by its header onto the right one. Raw mouse events (not
  // dragAndDrop) so the native HTML5 drag the Pane component listens for really
  // starts; the intermediate moves are what turns the press into a drag.
  const header = await win.locator('.pane').nth(0).locator('.pane-header').boundingBox();
  const target = await win.locator('.pane').nth(1).boundingBox();
  await win.mouse.move(header!.x + header!.width / 2, header!.y + header!.height / 2);
  await win.mouse.down();
  await win.mouse.move(header!.x + header!.width / 2 + 20, header!.y + header!.height / 2 + 5, { steps: 5 });
  await win.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 });
  await expect(win.locator('.pane.drop-target')).toHaveCount(1);
  await win.mouse.up();

  await expect(win.locator('.pane')).toHaveCount(2);
  await win.waitForTimeout(1200); // a replay (if any) + the refit would land here

  // Both terminals swapped places carrying their DOM node — same host element,
  // same content, no remount.
  await expect(win.locator('.pane').nth(0).locator('.xterm-host[data-probe="alive-1"]')).toHaveCount(1);
  await expect(win.locator('.pane').nth(1).locator('.xterm-host[data-probe="alive-0"]')).toHaveCount(1);
  await expect(rows(0)).toContainText('SWAP_PROBE_1');
  await expect(rows(1)).toContainText('SWAP_PROBE_0');
  // Nothing replayed saved scrollback into a live pane.
  await expect(win.getByRole('status').filter({ hasText: 'History restored.' })).toHaveCount(0);

  // Focus the left pane by clicking its terminal, then move the focus right with
  // the keyboard only and type without clicking anywhere.
  await win.locator('.pane').nth(0).locator('.xterm-screen').click();
  await win.keyboard.press(`${MOD}+Shift+ArrowRight`);
  // The store applies focus after React commits the active pane. Wait for the
  // actual input target, not an arbitrary delay or just the highlighted frame.
  await expect(win.locator('.pane').nth(1).getByRole('textbox', { name: 'Terminal input' })).toBeFocused();
  await win.keyboard.type('echo FOCUS_MOVED_5150');
  await win.keyboard.press('Enter');

  // The text went to the pane the shortcut moved to, not the one it came from.
  await expect(win.locator('.pane').nth(1)).toHaveClass(/focused/);
  await expect(rows(1)).toContainText('FOCUS_MOVED_5150');
  await expect(rows(0)).not.toContainText('FOCUS_MOVED_5150');

  await app.close();
});
