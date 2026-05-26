import { describe, it, expect } from 'vitest';
import { isBoundsVisible, type DisplayRect } from '../src/main/window-bounds';

const main: DisplayRect = { x: 0, y: 0, width: 1920, height: 1080 };

describe('isBoundsVisible', () => {
  it('returns true when the window sits well inside a display', () => {
    expect(isBoundsVisible({ x: 100, y: 100, width: 800, height: 600, isMaximized: false }, [main])).toBe(true);
  });

  it('returns false when the window is entirely off all displays', () => {
    expect(isBoundsVisible({ x: 5000, y: 5000, width: 800, height: 600, isMaximized: false }, [main])).toBe(false);
  });

  it('returns false when only a sliver (<50px) overlaps a display', () => {
    expect(isBoundsVisible({ x: 1900, y: 100, width: 800, height: 600, isMaximized: false }, [main])).toBe(false);
  });

  it('returns false when x/y are absent (no saved position)', () => {
    expect(isBoundsVisible({ width: 800, height: 600, isMaximized: false }, [main])).toBe(false);
  });

  it('returns true when overlapping a secondary display', () => {
    const second: DisplayRect = { x: 1920, y: 0, width: 1920, height: 1080 };
    expect(isBoundsVisible({ x: 2000, y: 100, width: 800, height: 600, isMaximized: false }, [main, second])).toBe(true);
  });
});
