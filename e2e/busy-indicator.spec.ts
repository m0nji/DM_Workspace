import { test, expect, _electron as electron } from '@playwright/test';
import { waitForShellPrompt } from './wait-helpers';

// Der Laufanzeiger stützt sich auf zwei Quellen: den privaten Prompt-Marker der
// Shell-Integration und, wo der fehlt, die Ausgabe-Erkennung. Dieser Spec prüft
// die zweite — den Rückfall, der greift, sobald eine Pane in einer Shell ohne
// unseren Hook sitzt (cmd.exe, ssh, ein Agent, ein Multiplexer).
//
// Der Fall ist deshalb wichtig, weil er einmal falsch gebaut war: solange
// `paneShell === 'running'` die Ausgabe schlug, blieb der Ring vom Start einer
// solchen Shell bis zu deren Ende an — gemessen an echten Claude- und
// Codex-Sitzungen, wo er damit dauerhaft leuchtete. Seither entscheidet in
// diesem Zustand die Ausgabe, und genau das hält der Test fest.
test.skip(process.platform !== 'win32', 'startet cmd.exe, nur auf Windows sinnvoll');
test.setTimeout(90000);

test('a shell without our prompt hook falls back to output detection', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1', DMWS_DISABLE_WEBGL: '1' }
  });
  const win = await app.firstWindow();
  await expect(win.locator('.sidebar')).toBeVisible();
  await win.evaluate(() => {
    (window as unknown as { __store: { getState: () => { updateSettings: (p: unknown) => void } } })
      .__store.getState().updateSettings({ busyIndicator: 'ring' });
  });

  await win.getByText('1 Pane').click();
  await expect(win.locator('.pane .xterm-screen')).toBeVisible();
  await waitForShellPrompt(win);

  const dot = win.locator('.ws-item .dot').first();
  // Am eigenen Prompt ist die Auskunft der Shell eindeutig: hier läuft nichts.
  await expect(dot).not.toHaveClass(/running/);

  await win.locator('.pane .xterm-screen').click();
  await win.keyboard.type('cmd');
  await win.keyboard.press('Enter');
  await expect(win.locator('.xterm-rows').first()).toContainText('Microsoft Windows');

  // Der Kern: cmd.exe druckt nie unseren Marker, der Zustand bleibt also bis zu
  // dessen Ende 'running'. Trotzdem darf der Ring nicht hängen bleiben — die
  // innere Shell wartet nur auf Eingabe, und das sagt allein die Ausgabe.
  await expect(dot, 'ohne Marker darf der Ring nicht dauerhaft anstehen')
    .not.toHaveClass(/running/, { timeout: 15000 });

  // Etwas, das mehrere Sekunden lang Zeilen schreibt: jetzt muss er anstehen.
  await win.keyboard.type('ping -n 5 127.0.0.1');
  await win.keyboard.press('Enter');
  await expect(dot, 'laufende Ausgabe muss den Ring anschalten').toHaveClass(/running/, { timeout: 15000 });

  // Und danach von allein wieder ausgehen.
  await expect(dot, 'nach dem Kommando muss er wieder ausgehen')
    .not.toHaveClass(/running/, { timeout: 20000 });

  // Zurück in die äußere Shell: dort meldet der Marker wieder selbst, dass sie
  // frei ist — die stärkere Auskunft, die die Ausgabe-Erkennung nicht hat.
  await win.keyboard.type('exit');
  await win.keyboard.press('Enter');
  await expect
    .poll(() => win.evaluate(() => {
      const s = (window as unknown as { __store: { getState: () => { paneShell: Record<string, string> } } })
        .__store.getState();
      return Object.values(s.paneShell)[0] ?? '-';
    }), { timeout: 20000 })
    .toBe('atPrompt');
  await expect(dot).not.toHaveClass(/running/);

  await app.close();
});
