import { defineConfig } from '@playwright/test';

// Konvention: jede Spec startet Electron mit `--lang=en-US`.
//
// Die App leitet ihre Sprache aus navigator.language ab (siehe
// i18n/resolveLocale), solange der Nutzer nichts explizit gesetzt hat. Auf einer
// Maschine mit deutschem Locale rendert sie deshalb deutsche Texte, auf die
// keine der englischen Assertions passt — und das Locale eines CI-Runners ist
// nicht garantiert. Der Flag pinnt die UI-Sprache, damit die Specs überall
// dasselbe sehen. Playwright kann das nicht zentral setzen: die Launch-Args
// gehören zu electron.launch() in der jeweiligen Spec.
export default defineConfig({
  testDir: './e2e',
  // Sweeps the temp dirs the specs and the app leave in the system temp folder;
  // see e2e/global-teardown.ts for why the app cannot do this itself.
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 30000,
  fullyParallel: false,
  expect: { timeout: 10000 }
});
