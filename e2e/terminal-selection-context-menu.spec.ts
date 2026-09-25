import { test, expect, _electron as electron, type Page } from '@playwright/test';

// Regression: TUIs like Codex switch on mouse tracking (DECSET 1003 + SGR 1006).
// xterm then reports every mouse move and the right-button press to the program
// as *user input* — and user input clears the selection. A Shift+drag selection
// vanished on the way to the right-click, so "Copy" in the menu was disabled.

async function cellCenter(win: Page, col: number, row: number): Promise<{ x: number; y: number }> {
  const box = await win.locator('.pane .xterm-screen').boundingBox();
  const size = await win.evaluate(() => {
    const sizes = (window as unknown as { __termSize: Map<string, () => { cols: number; rows: number }> }).__termSize;
    return [...sizes.values()][0]();
  });
  if (!box) throw new Error('terminal screen not laid out');
  const cw = box.width / size.cols;
  const ch = box.height / size.rows;
  return { x: box.x + (col + 0.5) * cw, y: box.y + (row + 0.5) * ch };
}

for (const mouseMode of [false, true]) {
  test(`a selection survives the right-click (mouse tracking ${mouseMode ? 'on' : 'off'})`, async () => {
    const app = await electron.launch({
      args: ['out/main/index.js', '--lang=en-US'],
      env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
    });
    const win = await app.firstWindow();
    const termWrite = (data: string) =>
      win.evaluate((d) => {
        const writes = (window as unknown as { __termWrite: Map<string, (s: string) => void> }).__termWrite;
        [...writes.values()][0](d);
      }, data);

    await expect(win.getByText('How many terminals do you want to open?')).toBeVisible();
    await win.getByText('1 Pane').click();
    await expect(win.locator('.pane .xterm-screen')).toBeVisible();
    await expect.poll(() => win.evaluate(() => !!(window as unknown as { __termWrite?: Map<string, unknown> }).__termWrite?.size)).toBe(true);

    // Paint a known word on row 0 in the alternate screen, where the shell
    // prompt cannot overwrite it, and switch mouse tracking on like Codex does.
    await termWrite('\x1b[?1049h\x1b[2J\x1b[HSELECTME rest of line');
    if (mouseMode) await termWrite('\x1b[?1003;1006h');

    const from = await cellCenter(win, 0, 0);
    // xterm selects a cell once the pointer passes its middle: ending just
    // short of cell 8's middle selects exactly "SELECTME" (cells 0–7).
    const to = await cellCenter(win, 8, 0);
    to.x -= 2;
    // Shift forces a selection even while the program owns the mouse.
    if (mouseMode) await win.keyboard.down('Shift');
    await win.mouse.move(from.x - 2, from.y);
    await win.mouse.down();
    await win.mouse.move(to.x, to.y, { steps: 5 });
    await win.mouse.up();
    if (mouseMode) await win.keyboard.up('Shift');

    // Move the pointer away before right-clicking, as a user would.
    const rc = await cellCenter(win, 20, 3);
    await win.mouse.move(rc.x, rc.y, { steps: 5 });
    await win.mouse.click(rc.x, rc.y, { button: 'right' });

    const copy = win.locator('.context-menu-item', { hasText: /^Copy$/ });
    await expect(copy).toBeEnabled();
    await copy.click();
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('SELECTME');

    await app.close();
  });
}
