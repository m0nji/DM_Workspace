// menu.ts imports electron at the top level. Stub it out so vitest (node env)
// can import the module without Electron being present.
import { vi } from 'vitest';
vi.mock('electron', () => ({
  app: { isPackaged: true },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
}));

import { describe, it, expect } from 'vitest';
import { buildMenuTemplate } from '../src/main/menu';
import type { MenuItemConstructorOptions } from 'electron';

function viewSubmenu(isMac: boolean): MenuItemConstructorOptions[] {
  const template = buildMenuTemplate(isMac, true);
  const view = template.find((item) => item.label === 'View');
  expect(view).toBeDefined();
  return view!.submenu as MenuItemConstructorOptions[];
}

describe('buildMenuTemplate zoom accelerators', () => {
  // Electron's zoomIn role registers CommandOrControl+Plus, which on Windows
  // resolves to Ctrl+Shift+<plus key> — plain Ctrl+Plus does nothing (macOS gets
  // a hidden Cmd+= item from Electron automatically, Windows does not). The
  // template must therefore carry explicit shift-less and numpad variants.
  it.each([true, false])('has a shift-less zoomIn accelerator (isMac=%s)', (isMac) => {
    const zoomIns = viewSubmenu(isMac).filter((i) => i.role === 'zoomIn');
    expect(zoomIns.map((i) => i.accelerator)).toContain('CommandOrControl+=');
  });

  it.each([true, false])('has numpad zoom accelerators (isMac=%s)', (isMac) => {
    const sub = viewSubmenu(isMac);
    expect(sub.filter((i) => i.role === 'zoomIn').map((i) => i.accelerator)).toContain('CommandOrControl+numadd');
    expect(sub.filter((i) => i.role === 'zoomOut').map((i) => i.accelerator)).toContain('CommandOrControl+numsub');
  });

  it('keeps the default role items so menu labels stay intact', () => {
    const sub = viewSubmenu(false);
    expect(sub.some((i) => i.role === 'zoomIn' && !i.accelerator)).toBe(true);
    expect(sub.some((i) => i.role === 'zoomOut' && !i.accelerator)).toBe(true);
    expect(sub.some((i) => i.role === 'resetZoom')).toBe(true);
  });

  it('hides the extra accelerator-only items from the visible menu', () => {
    const extras = viewSubmenu(false).filter((i) => i.accelerator);
    for (const item of extras) expect(item.visible).toBe(false);
  });
});
