import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  // Sweeps the temp dirs the specs and the app leave in the system temp folder;
  // see e2e/global-teardown.ts for why the app cannot do this itself.
  globalTeardown: './e2e/global-teardown.ts',
  timeout: 30000,
  fullyParallel: false,
  expect: { timeout: 10000 }
});
