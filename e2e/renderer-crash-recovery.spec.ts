import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { waitForShellPrompt, waitForScrollbackOnDisk } from './wait-helpers';

const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-crash-'));

// Nach forcefullyCrashRenderer() bleibt Playwrights Page-Objekt an der toten
// Renderer-Instanz hängen ("Target crashed"), auch wenn das Fenster längst neu
// geladen hat. Der Test liest und steuert den neuen Renderer deshalb über den
// Main-Prozess (webContents.executeJavaScript / sendInputEvent).
const inRenderer = (app: ElectronApplication, code: string): Promise<unknown> =>
  app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(c), code);

const BUFFER_TEXT = '(() => { const h = window.__bufferText; return h && h.size ? [...h.values()][0]() : null; })()';

// Direkt nach dem Absturz hängt executeJavaScript auf dem toten webContents,
// statt zu werfen — jede Abfrage bekommt deshalb ein eigenes Zeitlimit.
async function bufferText(app: ElectronApplication): Promise<string> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000));
  try {
    const text = await Promise.race([inRenderer(app, BUFFER_TEXT), timeout]);
    return typeof text === 'string' ? text : '';
  } catch {
    return ''; // Renderer lädt gerade
  }
}

test('the window comes back and the shell keeps working after the renderer process crashes', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_USERDATA: USERDATA, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' } as Record<string, string>
  });
  const win = await app.firstWindow();
  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen').first()).toBeVisible();
  await waitForShellPrompt(win);
  await win.locator('.pane .xterm-screen').first().click();
  await win.keyboard.type('echo BEFORE_CRASH');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('BEFORE_CRASH');
  // Der Verlauf liegt erst nach dem entprellten Schreiben im Main.
  await waitForScrollbackOnDisk(USERDATA, 'BEFORE_CRASH');

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer();
  });

  // Nach dem Reload lädt das Layout aus state.json, die Pane spielt ihren
  // Verlauf wieder ein.
  await expect.poll(() => bufferText(app), { timeout: 20000 }).toContain('BEFORE_CRASH');

  // Und die Shell nimmt wieder Eingaben an.
  await inRenderer(app, "document.querySelector('.xterm-helper-textarea').focus()");
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    for (const ch of 'echo AFTER_CRASH') wc.sendInputEvent({ type: 'char', keyCode: ch });
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  });
  await expect.poll(() => bufferText(app), { timeout: 10000 }).toContain('AFTER_CRASH');
  await app.close();
});
