import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Der Gegenpart zu restart-scrollback.spec.ts: dort wird der Default "an"
// geprüft, hier das Abschalten. Beide Launches teilen sich ein explizites
// userData-Verzeichnis, damit der zweite Start sieht, was der erste hinterlässt.
// DMWS_E2E bleibt aus (wie in restart-scrollback.spec.ts), damit DMWS_USERDATA
// nicht von einem Wegwerf-Temp-Verzeichnis überstimmt wird.
const USERDATA = mkdtempSync(join(tmpdir(), 'dmws-history-off-'));
const MARKER = 'HISTORY_OFF_MARKER_9001';
const MARKER_AFTER_OFF = 'HISTORY_OFF_MARKER_9002_POST_TOGGLE';

function launchEnv(): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env, DMWS_USERDATA: USERDATA, DMWS_DISABLE_WEBGL: '1'
  } as Record<string, string>;
  delete env.DMWS_E2E;
  return env;
}

test('disabling the history empties the file and starts the next launch clean', async () => {
  // ---- Launch 1: Verlauf erzeugen, dann die Option ausschalten ----
  const app1 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win1 = await app1.firstWindow();
  await expect(win1.getByText('How many terminals do you want to open?')).toBeVisible();
  await win1.getByText('1 Pane').click();
  await expect(win1.locator('.pane .xterm-screen').first()).toBeVisible();
  await win1.waitForTimeout(1500); // Shell startet und schreibt ihren Prompt

  await win1.locator('.pane .xterm-screen').first().click();
  await win1.keyboard.type(`echo ${MARKER}`);
  await win1.keyboard.press('Enter');
  await expect(win1.locator('.xterm-rows').first()).toContainText(MARKER);

  // Der Weg zur Platte ist zweistufig entprellt: der Save-Scheduler im
  // Renderer (1s) und danach der eigene Flush-Debounce des Stores im
  // Main-Prozess (1s) — macht ~2s bis der Marker tatsächlich auf der Platte
  // steht. Statt das per festem Timeout zu erraten, gepollt lesen, bis der
  // Marker ankommt; die Datei kann bis dahin auch noch fehlen (ENOENT).
  const file = join(USERDATA, 'scrollback.json');
  await expect.poll(() => {
    try { return readFileSync(file, 'utf8'); } catch { return ''; }
  }).toContain(MARKER);

  await win1.getByTitle('Settings').click();
  await win1.getByRole('button', { name: 'Session' }).click();
  await win1.locator('#restore-history-toggle').uncheck();
  await win1.locator('.modal-close').click();

  // Der Renderer persistiert Settings ohne Debounce; der Main-Prozess leert die
  // Datei im selben Zug.
  await expect.poll(() => readFileSync(file, 'utf8')).toBe('{}');

  // Der sichtbare Inhalt der laufenden Pane bleibt: Ausschalten löscht nichts,
  // was der Nutzer gerade liest.
  await expect(win1.locator('.xterm-rows').first()).toContainText(MARKER);

  // Bisher wurde nur geprüft, dass vorhandener Inhalt verworfen und der
  // Quit-Flush ihn nicht zurückschreibt — aber niemand hat nach dem Umschalten
  // noch etwas erzeugt. Ohne diese Probe würde eine Regression, bei der beide
  // Sperren (Main-Gate und Renderer-Verzicht) für neue Ausgabe gleichzeitig
  // versagen, unbemerkt bleiben. Anders als oben bei Zeile 43 taugt hier kein
  // expect.poll: die Datei ist von Anfang an "{}", also wäre die Behauptung
  // beim ersten Read schon "erfüllt" und der Poll käme sofort zurück, bevor
  // eine kaputte Sperre überhaupt die Chance hätte zu schreiben — eine negative
  // Behauptung ("bleibt leer") lässt sich nicht sinnvoll abwarten, nur eine
  // positive ("wird X"). Also: zweiten Marker tippen, damit tatsächlich etwas
  // durch die Sperren müsste, und danach fest warten, bis beide Debounces
  // (Save-Scheduler im Renderer + Flush-Debounce des Stores, je ~1s) samt
  // Marge verstrichen sind — erst dann sagt eine weiterhin leere Datei etwas
  // aus.
  await win1.locator('.pane .xterm-screen').first().click();
  await win1.keyboard.type(`echo ${MARKER_AFTER_OFF}`);
  await win1.keyboard.press('Enter');
  await expect(win1.locator('.xterm-rows').first()).toContainText(MARKER_AFTER_OFF);
  await win1.waitForTimeout(3000);
  expect(readFileSync(file, 'utf8')).toBe('{}');

  await app1.close();

  // Auch der Flush beim Beenden darf nichts zurückschreiben.
  expect(readFileSync(file, 'utf8')).toBe('{}');

  // ---- Launch 2: Layout kommt zurück, der Verlauf nicht ----
  const app2 = await electron.launch({ args: ['out/main/index.js', '--lang=en-US'], env: launchEnv() });
  const win2 = await app2.firstWindow();
  await expect(win2.locator('.pane .xterm-screen').first()).toBeVisible();
  await win2.waitForTimeout(1500);

  const text = await win2.locator('.xterm-rows').first().innerText();
  expect(text).not.toContain(MARKER);
  expect(text).not.toContain('wiederhergestellt'); // kein Restore-Separator
  expect(readFileSync(file, 'utf8')).toBe('{}');

  await app2.close();
});
