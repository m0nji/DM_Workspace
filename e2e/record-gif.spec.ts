import { test, _electron as electron } from '@playwright/test';
import { join } from 'path';
import { writeFileSync, mkdirSync, rmSync } from 'fs';

// Recording helper (NOT a test): drives the real app to produce the frames for
// the README demo GIF. It is skipped by the normal suite and only runs when
// RECORD_GIF is set, because it depends on this seeded throwaway environment
// rather than asserting anything:
//
//   npm run build && RECORD_GIF=1 npx playwright test e2e/record-gif.spec.ts
//
// then turn the frames into the GIF (alpha flattened to black so the GIF has no
// transparency index — otherwise earlier frames ghost through):
//
//   magick -delay 9 -loop 0 /tmp/dmws-gif/frames/f*.png \
//     -background black -alpha remove -alpha off -resize 1000x -colors 128 \
//     assets/demo.gif
//
// A neutral ZDOTDIR prompt + a seeded neutral cwd keep the real user/host out of
// frame; commands avoid anything that prints the username (no pwd/whoami/ls -l).

const REC = '/tmp/dmws-gif';
const FRAMES = join(REC, 'frames');
const DEMO_CWD = '/tmp/web-app';

// Build the throwaway recording environment from scratch so the run is
// reproducible without any manual setup.
function seedEnv(): void {
  rmSync(FRAMES, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  mkdirSync(join(REC, 'userdata'), { recursive: true });
  mkdirSync(join(REC, 'zdotdir'), { recursive: true });

  // A neutral working dir so `ls` shows a plausible project and the pane title
  // reads "/tmp/web-app" — never the real home path.
  mkdirSync(join(DEMO_CWD, 'src'), { recursive: true });
  mkdirSync(join(DEMO_CWD, 'tests'), { recursive: true });
  for (const f of ['README.md', 'package.json', 'src/app.ts', 'tests/app.test.ts']) {
    writeFileSync(join(DEMO_CWD, f), '');
  }

  // Recording-only zsh prompt: no user, host or path — just "demo ❯".
  writeFileSync(join(REC, 'zdotdir', '.zshrc'),
    "PROMPT='%F{cyan}demo%f %F{green}❯%f '\nRPROMPT=''\nexport HISTFILE=/tmp/dmws-gif/.zsh_history\nclear\n");
  // ZDOTDIR overrides the user's ~/.zprofile, so re-add Homebrew to PATH here.
  writeFileSync(join(REC, 'zdotdir', '.zprofile'),
    '[ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"\n');

  // One workspace, empty layout (so the welcome screen shows first), neutral cwd.
  writeFileSync(join(REC, 'userdata', 'state.json'), JSON.stringify({
    version: 1,
    activeWorkspaceId: 'w1',
    workspaces: [{ id: 'w1', name: 'Demo', cwd: DEMO_CWD, layout: null }],
    settings: { themeId: 'default', terminalOpacity: 0.95 }
  }, null, 2));
}

test('record demo frames', async () => {
  test.skip(!process.env.RECORD_GIF, 'recording helper — run with RECORD_GIF=1');
  test.setTimeout(180000);
  let n = 0;

  seedEnv();

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

  // Capture one or more identical frames; `hold` repeats it to dwell longer.
  const shot = async (hold = 1) => {
    const buf = await win.screenshot();
    for (let i = 0; i < hold; i++) {
      writeFileSync(join(FRAMES, `f${String(n++).padStart(4, '0')}.png`), buf);
    }
  };

  // Type a string, capturing a frame as characters appear so typing looks animated.
  const typeAnim = async (text: string, step = 2) => {
    for (let i = 0; i < text.length; i++) {
      await win.keyboard.type(text[i]);
      if (i % step === 0 || i === text.length - 1) await shot();
    }
  };

  // 1) Welcome screen — choosing how many terminals to open.
  await win.getByText('How many terminals do you want to open?').waitFor();
  await win.waitForTimeout(400);
  await shot(8);

  // 2) Pick the 4 (2×2) layout, then let all four shells reach their prompt.
  await win.getByText('4 (2×2)').click();
  await win.locator('.pane .xterm-screen').first().waitFor();
  await win.waitForTimeout(2200);

  const panes = win.locator('.pane .xterm-screen');

  // Clear each pane first: the app injects a one-time OSC-7 cwd hook line
  // (`__dmws_cwd(){ ... }`) into every shell at startup — wipe it so the demo
  // starts from a clean prompt. Not captured.
  for (let p = 0; p < 4; p++) {
    await panes.nth(p).click();
    await win.keyboard.type('clear');
    await win.keyboard.press('Enter');
    await win.waitForTimeout(250);
  }
  await win.waitForTimeout(400);
  await shot(8);

  // 3) Run a command (or two) in each pane. No quotes in the echo: per-keystroke
  // typing can drop a closing quote and trap the shell in a dquote> prompt.
  const runs: string[][] = [
    ['echo Hello from DM Workspace', 'date'],
    ['ls'],
    ['git --version', 'node -v'],
    ['cal']
  ];

  for (let p = 0; p < 4; p++) {
    await panes.nth(p).click();
    await win.waitForTimeout(250);
    await shot(2);
    for (const cmd of runs[p]) {
      await typeAnim(cmd);
      await shot(3); // command fully typed, not yet run
      await win.keyboard.press('Enter');
      for (let k = 0; k < 5; k++) {
        await win.waitForTimeout(140);
        await shot(); // output streaming in
      }
      await shot(2);
    }
  }

  // 4) Final dwell on the finished 2×2 grid.
  await win.waitForTimeout(400);
  await shot(12);

  await app.close();
});
