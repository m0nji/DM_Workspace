import { readFileSync, statSync } from 'fs';
import { join } from 'path';
import type { Page } from '@playwright/test';

// Shared waits for the specs that drive a real shell across an app restart.
//
// These used to be fixed sleeps ("1500ms should be enough for the prompt"),
// which is a guess about the slowest machine the suite will ever run on. On
// Windows it is a bad guess: PowerShell starts through -NoExit -Command plus the
// user profile, and Defender inspects both the process and every file write, so
// a wait tuned on macOS expires before the shell is ready — the keystrokes then
// land in a shell that is not listening, and the assertion fails on a symptom
// far from the cause. Each helper waits for the thing it actually needs instead.

async function until(check: () => Promise<boolean> | boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeoutMs}ms waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

// The shell has printed its first prompt — the pane is ready for typed input.
// Any shell prints something; an empty buffer means it is still starting.
export async function waitForShellPrompt(win: Page, paneIndex = 0, timeoutMs = 20000): Promise<void> {
  const rows = win.locator('.pane .xterm-rows').nth(paneIndex);
  await rows.waitFor({ state: 'visible', timeout: timeoutMs });
  await until(async () => (await rows.innerText()).trim().length > 0, timeoutMs, 'the shell prompt');
}

// The pane's scrollback has actually reached disk. The renderer debounces the
// serialize and the main process batches the write, so "the text is on screen"
// does not mean "a restart would find it" — this waits for the file the next
// launch will read.
export async function waitForScrollbackOnDisk(userData: string, marker: string, timeoutMs = 20000): Promise<void> {
  const file = join(userData, 'scrollback.json');
  await until(() => {
    try {
      return readFileSync(file, 'utf8').includes(marker);
    } catch {
      return false; // not written yet
    }
  }, timeoutMs, `"${marker}" in scrollback.json`);
}

export function scrollbackMtime(userData: string): number {
  try {
    return statSync(join(userData, 'scrollback.json')).mtimeMs;
  } catch {
    return 0;
  }
}

// A launch that RESTORED a pane has written its own save. Content cannot tell
// that apart from the previous launch's — the restore separator is filtered out
// before saving, so both versions look alike — so this waits for the file to be
// rewritten at all.
export async function waitForScrollbackRewrite(userData: string, since: number, timeoutMs = 20000): Promise<void> {
  await until(() => scrollbackMtime(userData) > since, timeoutMs, 'the scrollback re-save');
}
