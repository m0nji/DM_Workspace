import { test, expect, _electron as electron } from '@playwright/test';

// Skia Graphite crashes the GPU process every few hours on macOS (CHECK in
// GraphiteSharedContext::InsertRecordingImpl), costing every pane its WebGL
// context. The main process disables it on macOS — guard that the switch really
// reaches Chromium (a second disable-features switch would silently replace it)
// while WebGL and GPU compositing stay on.
test('macOS runs without Skia Graphite but keeps WebGL and GPU compositing', async () => {
  test.skip(process.platform !== 'darwin', 'Graphite is only disabled on macOS');
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  await app.firstWindow();

  // skia_graphite is reported by Chromium but missing from Electron's typings.
  const status = await app.evaluate(({ app }) => app.getGPUFeatureStatus() as unknown as Record<string, string>);
  expect(status.skia_graphite).toMatch(/^disabled/);
  expect(status.webgl).toBe('enabled');
  expect(status.gpu_compositing).toBe('enabled');

  await app.close();
});
