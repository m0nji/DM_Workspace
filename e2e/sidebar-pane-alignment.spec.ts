import { test, expect, _electron as electron } from '@playwright/test';

// Regression guard for the two chrome surfaces that sit side by side: the
// workspace navigation and the pane grid.
//
// 79c9f89 adopted the DM_CICD grouped-surface rule and turned the sidebar into a
// floating rounded card (margin: 8px, radius 12) — but the pane grid kept running
// edge to edge (.workspace-view / .ws-host / .split-container are all inset: 0).
// The two surfaces then had different heights (807 vs 823 in an 861px window) and
// their corners sat 8px apart.
//
// The sidebar is flush again, on EVERY platform: the mismatch was loudest on the
// opaque, square Windows window, but macOS' translucent, natively rounded one
// only softened it. Asserting one shape everywhere keeps the two platforms from
// drifting apart — a platform-scoped fix here would have done exactly that.
test('sidebar and pane area share one vertical extent', async () => {
  const app = await electron.launch({
    args: ['out/main/index.js', '--lang=en-US'],
    env: { ...process.env, DMWS_E2E: '1' }
  });
  const win = await app.firstWindow();
  await expect(win.locator('.sidebar')).toBeVisible();

  const sidebar = await win.locator('.sidebar').boundingBox();
  const view = await win.locator('.workspace-view').boundingBox();
  expect(sidebar).not.toBeNull();
  expect(view).not.toBeNull();

  // One shared top and bottom edge, so neither surface is taller than the other.
  expect(sidebar!.y).toBeCloseTo(view!.y, 0);
  expect(sidebar!.y + sidebar!.height).toBeCloseTo(view!.y + view!.height, 0);

  // Flush chrome: no rounding that would need air the pane grid does not leave,
  // and no margin that would shorten the group against the panes beside it.
  const box = await win.locator('.sidebar').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { radius: cs.borderRadius, margin: cs.margin, background: cs.backgroundColor };
  });
  expect(box.radius).toBe('0px');
  expect(box.margin).toBe('0px');

  // The sidebar MUST carry its own opaque fill. body is transparent on purpose
  // (macOS window vibrancy shows through the terminals), so an unfilled sidebar
  // does not fall back to the app background — it falls back to the system's
  // neutral-gray vibrancy material and drops out of the brand palette. That is
  // invisible on Windows, whose window is opaque, so only an assertion catches it.
  expect(box.background).not.toBe('transparent');
  expect(box.background).not.toMatch(/rgba\(0,\s*0,\s*0,\s*0\)/);

  await app.close();
});
