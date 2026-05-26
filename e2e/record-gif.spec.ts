import { test, _electron as electron } from '@playwright/test';
import { join } from 'path';

// Recording-only: drives the real app to produce frames for the README demo GIF.
// Run explicitly, not as part of the normal e2e suite:
//   npx playwright test e2e/record-gif.spec.ts
// A neutral ZDOTDIR prompt + seeded neutral cwd keep the real user/host out of frame.

const REC = '/tmp/dmws-gif';
const FRAMES = join(REC, 'frames');

test('record demo frames', async () => {
  test.setTimeout(120000);
  let n = 0;

  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      DMWS_USERDATA: join(REC, 'userdata'),
      ZDOTDIR: join(REC, 'zdotdir'),
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor'
    }
  });
  const win = await app.firstWindow();

  // Capture one or more identical frames; `hold` repeats it to dwell longer in the GIF.
  const shot = async (hold = 1) => {
    const buf = await win.screenshot();
    for (let i = 0; i < hold; i++) {
      const fs = await import('fs');
      fs.writeFileSync(join(FRAMES, `f${String(n++).padStart(3, '0')}.png`), buf);
    }
  };

  // 1) Welcome screen — choosing how many terminals to open.
  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.waitForTimeout(400);
  await shot(4);

  // 2) Pick the 4 (2×2) layout.
  await win.getByText('4 (2×2)').click();
  await win.locator('.pane .xterm-screen').first().waitFor();
  await win.waitForTimeout(2000); // let all four shells reach their prompt
  await shot(4);

  // 3) Run a command (or two) in each pane.
  const panes = win.locator('.pane .xterm-screen');
  const runs: string[][] = [
    ['echo "Welcome to DM Workspace 👋"', 'date'],
    ['ls'],
    ['git --version', 'node -v'],
    ['cal']
  ];

  for (let p = 0; p < 4; p++) {
    await panes.nth(p).click();
    await win.waitForTimeout(300);
    for (const cmd of runs[p]) {
      await win.keyboard.type(cmd, { delay: 45 });
      await shot(2); // command typed, not yet run
      await win.keyboard.press('Enter');
      await win.waitForTimeout(900);
      await shot(3); // output shown
    }
  }

  // 4) Final dwell on the finished 2×2 grid.
  await win.waitForTimeout(400);
  await shot(6);

  await app.close();
});
