import type { BrowserWindow } from 'electron';
import type { WindowBounds } from '../shared/types';

// A display rectangle in screen coordinates (matches Electron's Display.bounds).
export interface DisplayRect { x: number; y: number; width: number; height: number; }

// True if the saved bounds overlap at least one display by a usable margin.
// Requires both x and y to be present — a window with no saved position is
// considered "not visible" so the caller centers it instead.
const MIN_VISIBLE = 50; // px that must overlap a display in each axis
export function isBoundsVisible(b: WindowBounds, displays: DisplayRect[]): boolean {
  if (b.x === undefined || b.y === undefined) return false;
  const x = b.x, y = b.y;
  return displays.some((d) => {
    const ix = Math.max(x, d.x);
    const iy = Math.max(y, d.y);
    const ax = Math.min(x + b.width, d.x + d.width);
    const ay = Math.min(y + b.height, d.y + d.height);
    return (ax - ix) >= MIN_VISIBLE && (ay - iy) >= MIN_VISIBLE;
  });
}

// Snapshot a window's restorable bounds. When maximized, getNormalBounds()
// returns the pre-maximize rectangle so the un-maximized size is correct after
// restore; isMaximized is stored separately so the window re-maximizes on launch.
export function currentWindowBounds(win: BrowserWindow): WindowBounds {
  const isMaximized = win.isMaximized();
  const b = isMaximized ? win.getNormalBounds() : win.getBounds();
  return { x: b.x, y: b.y, width: b.width, height: b.height, isMaximized };
}
