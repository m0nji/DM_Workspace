import { test, expect, _electron as electron, type Page, type Locator } from '@playwright/test';
import { mkdtempSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { waitForShellPrompt, waitForPaneBuffer, paneBufferText } from './wait-helpers';

// Regression: typed input is painted INTO the prompt instead of behind it.
//
// Windows PowerShell 5.1 bundles PSReadLine 2.0.0, whose RecomputeInitialCoords
// recomputes the input column modulo the buffer width:
//
//     _initialX = _initialX % console.BufferWidth;
//
// That is only sound while the prompt fits on one line. Make a pane narrower
// than its own prompt and the prompt wraps — _initialX legitimately becomes the
// remainder (97 % 77 == 20). Widen the pane again and the prompt unwraps, so the
// cursor is really back at column 97, but the modulo keeps the remainder
// (20 % 146 == 20). From then on every keystroke is drawn from column 20, i.e.
// in the middle of the prompt:
//
//     PS C:\Users\Diego\…\StreamingAPP>   →   PS C:\claudeDiego\…
//
// The command still runs correctly; only the column is wrong, and only a fresh
// prompt (one Enter) heals the pane. See
// docs/superpowers/plans/2026-08-22-psreadline-initialx-fix.md.
//
// The test drives the real path — viewport change → ResizeObserver → fit →
// pty:resize — and checks its own preconditions along the way, so a green run
// can only mean "the prompt survived", never "the pane was never narrow enough".
test.skip(process.platform !== 'win32', 'PSReadLine/ConPTY-Verhalten; nur Windows PowerShell');

// Two shell round-trips plus three resizes on top of an Electron launch; the
// 30s default from playwright.config is too tight on a cold Windows machine.
test.setTimeout(90000);

const TYPED = 'ZZTEST';
const WIDE = { width: 1400, height: 900 };
// Absolute length of the pane's working folder. The prompt ("PS <path>> ") is
// two cells longer, and the whole bug hinges on that number sitting between the
// narrow and the wide column count — see the preconditions below.
const FOLDER_LENGTH = 92;

// A working folder deep enough to make the prompt longer than the pane will be
// narrowed to. The bug is a function of prompt length, so the folder must not
// inherit whatever depth the checkout happens to have: nest fixed segments under
// the temp dir until the absolute path reaches `targetLength`. The dmws-e2e-
// prefix is the one e2e/global-teardown.ts sweeps.
function deepWorkFolder(targetLength: number): string {
  let dir = mkdtempSync(join(tmpdir(), 'dmws-e2e-psrl-'));
  // +5 = the separator plus a segment worth having; the last pass lands exactly
  // on targetLength, and an already-long temp root simply leaves the dir longer.
  while (dir.length + 5 <= targetLength) {
    dir = join(dir, 'p'.repeat(Math.min(24, targetLength - dir.length - 1)));
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

// The prompt exactly as PowerShell printed it, read back from the buffer rather
// than rebuilt from the JS path: PowerShell reports the filesystem's canonical
// casing, which need not match what os.tmpdir() returned. translateToString
// trims the line, so the prompt's own trailing blank is added back here.
// Matching at all also proves the prompt fits on ONE line at the starting width.
async function readPrompt(win: Page): Promise<string> {
  let prompt = '';
  await expect
    .poll(async () => {
      const line = (await paneBufferText(win)).split('\n').find((l) => /^PS .+>$/.test(l));
      if (line) prompt = `${line} `;
      return prompt;
    }, { timeout: 20000, message: 'no single-line "PS …>" prompt in the pane buffer' })
    .not.toBe('');
  return prompt;
}

// Ask the shell how wide its console is. This is the very value PSReadLine reads
// (Console.BufferWidth), and getting an answer proves the resize reached the pty
// instead of stopping at xterm. The Enter this sends is also load-bearing: it
// makes PowerShell print a FRESH prompt at the current width.
async function askConsoleWidth(win: Page, screen: Locator, tag: string): Promise<number> {
  await screen.click();
  await win.keyboard.type(`"${tag}=$([console]::BufferWidth)"`);
  await win.keyboard.press('Enter');

  const reported = new RegExp(`^${tag}=(\\d+)$`, 'm');
  let cols = 0;
  await expect
    .poll(async () => {
      const m = reported.exec(await paneBufferText(win));
      if (m) cols = Number(m[1]);
      return cols;
    }, { timeout: 20000, message: `the shell never echoed ${tag}=<width>` })
    .toBeGreaterThan(0);
  return cols;
}

test('typed input stays behind the prompt after the pane is narrowed below it and widened again', async () => {
  const folder = deepWorkFolder(FOLDER_LENGTH);

  // DMWS_DISABLE_WEBGL like every spec that waits on waitForShellPrompt: with the
  // WebGL renderer .xterm-rows is the invisible accessibility layer, so the helper
  // waits for a node that never becomes visible. The DOM renderer still sizes
  // .xterm-screen to exactly cols × cell width, which is what the maths below needs.
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();

  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.setViewportSize(WIDE);

  // One pane rooted in the deep folder — the pane's cwd is what makes the prompt
  // long. Seeded through the store like pane-auto-title.spec does, so the folder
  // does not have to be picked through the welcome screen's directory dialog.
  await win.evaluate((cwd) => {
    const store = (window as unknown as {
      __store: { setState: (patch: unknown) => void };
    }).__store;
    store.setState({
      workspaces: [{
        id: 'w1', name: 'Workspace 1', cwd,
        layout: { type: 'pane', id: 'psreadline-initialx-pane' }
      }],
      activeWorkspaceId: 'w1'
    });
  }, folder);

  const screen = win.locator('.pane .xterm-screen').first();
  await expect(screen).toBeVisible();
  await waitForShellPrompt(win);

  const prompt = await readPrompt(win);

  // Precondition A: the pane starts WIDER than the prompt, so _initialX is the
  // full prompt length and there is something for the modulo to destroy.
  const wideCols = await askConsoleWidth(win, screen, 'W1');
  expect(wideCols, `the prompt is ${prompt.length} cells and must fit at the starting width`)
    .toBeGreaterThan(prompt.length);

  // Now narrower than the prompt. The viewport is the only lever a spec has, so
  // translate columns into pixels through the width xterm actually renders
  // (.xterm-screen is exactly cols × cell width). Aiming 20 columns short of the
  // prompt puts the wrap — and with it the bogus input column — in the middle of
  // the path, where a shredded prompt is unmistakable.
  const widePx = await screen.evaluate((el) => (el as HTMLElement).clientWidth);
  const pxPerCol = widePx / wideCols;
  const targetCols = Math.max(20, prompt.length - 20);
  await win.setViewportSize({
    width: Math.round(WIDE.width - (wideCols - targetCols) * pxPerCol),
    height: WIDE.height
  });

  // The resize scheduler defers the fit while the width is still changing and
  // then fits + sends pty:resize in the same tick — so once xterm has shrunk,
  // the pty:resize IPC is already out, and the keystrokes below queue behind it.
  await expect
    .poll(() => screen.evaluate((el) => (el as HTMLElement).clientWidth), { timeout: 10000 })
    .toBeLessThan(widePx - pxPerCol);

  // Precondition B: the shell really is narrower than its own prompt. The Enter
  // inside this helper then has PowerShell print a fresh, WRAPPED prompt at that
  // width — PSReadLine takes _initialX from the wrapped remainder.
  const narrowCols = await askConsoleWidth(win, screen, 'W2');
  expect(narrowCols, `the pane must end up narrower than the ${prompt.length}-cell prompt`)
    .toBeLessThan(prompt.length);

  // Back to the starting width: the prompt unwraps and the cursor is genuinely
  // at column prompt.length again — but PSReadLine keeps the remainder.
  await win.setViewportSize(WIDE);
  await expect
    .poll(() => screen.evaluate((el) => (el as HTMLElement).clientWidth), { timeout: 10000 })
    .toBeGreaterThan(widePx - pxPerCol);

  // Type, do NOT submit: the defect is purely in where the input is drawn.
  await screen.click();
  await win.keyboard.type(TYPED);
  await waitForPaneBuffer(win, TYPED);

  const echo = (await paneBufferText(win)).split('\n').find((l) => l.includes(TYPED)) ?? '';
  console.log(`prompt (${prompt.length} cells): ${prompt}`);
  console.log(`columns: wide=${wideCols} narrow=${narrowCols}`);
  console.log(`--- echo line ---\n${echo}\n--- end ---`);

  // The prompt must be untouched — when _initialX is stale the typed text has
  // overwritten cells inside the path and this substring is simply gone.
  expect(echo, 'the typed text was painted INTO the prompt (stale PSReadLine _initialX)')
    .toContain(prompt.trimEnd());
  // …and it must sit behind the prompt, with nothing else on the line. trimEnd
  // because a line is padded to the terminal width.
  expect(echo.trimEnd()).toBe(`${prompt}${TYPED}`);

  await app.close();
});
