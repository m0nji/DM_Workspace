import { describe, it, expect } from 'vitest';
import { windowIconFile } from '../src/main/window-icon';

describe('windowIconFile', () => {
  it('uses a PNG on Linux (an .ico renders poorly as the X11/Wayland window icon)', () => {
    expect(windowIconFile('linux')).toBe('icon.png');
  });

  it('uses the .ico on Windows', () => {
    expect(windowIconFile('win32')).toBe('icon.ico');
  });

  it('falls back to the .ico on macOS (the real icon comes from the app bundle)', () => {
    expect(windowIconFile('darwin')).toBe('icon.ico');
  });
});
