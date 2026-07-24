import { test, expect, _electron as electron } from '@playwright/test';

// Regression: the host-height pin (black-bar fix) froze the ResizeObserver.
// The observer watched .xterm-host, whose height is pinned to a fixed pixel
// value after every fit — so a height-only pane resize (dragging a splitter)
// never fired it and the terminal kept its old row count, clipping content
// until a full-window resize changed the host *width*. The observer must watch
// the wrapper (.xterm-host-wrap), which always follows the pane layout.
test('terminal refits after a height-only pane resize via splitter drag', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('4 (2×2)').click();
  await expect(win.locator('.pane')).toHaveCount(4);
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();

  // The first vertical split stacks two panes; its splitter resizes heights only.
  const vSplitter = win.locator('.split-container.v > .splitter').first();
  const topWrap = win.locator('.split-container.v .xterm-host-wrap').first();
  const topHost = topWrap.locator('.xterm-host');

  // Wait until the host is pinned (inline height set), the state under test.
  await expect.poll(async () => topHost.evaluate((el) => el.style.height)).toMatch(/px$/);

  const cellHeight = await topHost.evaluate((el) => {
    const screen = el.querySelector('.xterm-screen') as HTMLElement;
    const rows = screen.querySelectorAll('.xterm-rows > div').length || 24;
    return Math.max(screen.offsetHeight / rows, 10);
  });

  // Drag the splitter down to enlarge the top pane.
  const box = (await vSplitter.boundingBox())!;
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 120, { steps: 8 });
  await win.mouse.up();

  // The wrapper must have grown…
  const wrapH = await topWrap.evaluate((el) => el.clientHeight);
  // …and the terminal must refit to use it: pinned host height within one cell
  // of the wrapper height (fit rounds down to whole rows).
  await expect
    .poll(async () => topHost.evaluate((el) => el.clientHeight), { timeout: 5000 })
    .toBeGreaterThan(wrapH - cellHeight - 1);

  await app.close();
});
