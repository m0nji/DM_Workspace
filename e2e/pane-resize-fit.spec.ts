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

test('terminal settles rapid window narrowing and remains editable', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  try {
    const win = await app.firstWindow();
    await win.getByText('1 Pane', { exact: true }).click();
    const host = win.locator('.xterm-host').first();
    await expect(host.locator('.xterm-screen')).toBeVisible();
    const input = host.locator('.xterm-helper-textarea');
    const text = () => win.evaluate(() => {
      const hooks = (window as unknown as { __bufferText: Map<string, () => string> }).__bufferText;
      return [...hooks.values()].map(read => read()).join('\n');
    });
    // A visible xterm precedes the async PTY spawn and shell integration.
    await expect.poll(text).toMatch(/[>$#❯]/);
    await input.focus();
    await win.keyboard.type('RESIZE_INPUT_123', { delay: 30 });
    await expect.poll(text).toContain('RESIZE_INPUT_123');
    for (const [width, height] of [[1400, 900], [1100, 750], [900, 650], [800, 620], [1000, 700]]) {
      await app.evaluate(({ BrowserWindow }, size) => {
        BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
      }, [width, height]);
      await win.waitForTimeout(25);
    }
    await expect.poll(() => host.evaluate(el => {
      const screen = el.querySelector('.xterm-screen') as HTMLElement;
      const wrap = el.parentElement!;
      return screen.offsetWidth <= wrap.clientWidth && screen.offsetWidth > wrap.clientWidth - 40
        && screen.offsetHeight <= wrap.clientHeight && screen.offsetHeight > wrap.clientHeight - 40;
    })).toBe(true);
    await input.focus();
    await win.keyboard.press('End');
    await win.keyboard.type('_EDITED');
    await expect.poll(text).toContain('RESIZE_INPUT_123_EDITED');
  } finally {
    await app.close();
  }
});
