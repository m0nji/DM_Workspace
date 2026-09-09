import { afterEach, describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/xterm';
import { resizeConptyTerminal } from '../src/renderer/terminal/conpty-resize';

const terminals: Terminal[] = [];
function terminal(scrollback = 1000): Terminal {
  const t = new Terminal({ cols: 100, rows: 35, scrollback,
    windowsPty: { backend: 'conpty', buildNumber: 26200 } });
  terminals.push(t);
  return t;
}
const write = (t: Terminal, data: string) => new Promise<void>(resolve => t.write(data, resolve));
function text(t: Terminal): string {
  const b = t.buffer.active;
  return Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) ?? '').join('\n');
}
function invariants(t: Terminal): void {
  const b = t.buffer.active;
  expect(b.cursorY).toBeGreaterThanOrEqual(0);
  expect(b.cursorY).toBeLessThan(t.rows);
  expect(b.baseY).toBeGreaterThanOrEqual(0);
  expect(b.viewportY).toBeGreaterThanOrEqual(0);
  expect(b.viewportY).toBeLessThanOrEqual(b.baseY);
  expect(b.length).toBe(b.baseY + t.rows);
  expect(b.length).toBeLessThanOrEqual(t.rows + (t.options.scrollback ?? 1000));
  for (let i = 0; i < b.length; i++) expect(b.getLine(i)).toBeDefined();
}
afterEach(() => terminals.splice(0).forEach(t => t.dispose()));

describe('ConPTY viewport resize with the real xterm buffer', () => {
  it('keeps history once and places the cursor where the native resize repaint expects it', async () => {
    const t = terminal();
    const lines = Array.from({ length: 70 }, (_, i) => `ROW_${String(i).padStart(3, '0')} ${'abcdefghij'.repeat(8)}`);
    await write(t, lines.join('\r\n') + '\r\n');
    resizeConptyTerminal(t, 60, 20);
    resizeConptyTerminal(t, 100, 35);
    // Captured from the real system ConPTY's cursor-position command after
    // resizing 100x35 -> 60x20 -> 100x35. xterm alone leaves cursorY at 19.
    expect(t.buffer.active.cursorY).toBe(10);
    for (let i = 0; i < 10; i++) {
      for (const [cols, rows] of [[60, 35], [100, 35], [100, 20], [100, 35]]) {
        resizeConptyTerminal(t, cols, rows);
        invariants(t);
        expect(text(t).match(/ROW_\d{3}/g)).toEqual(lines.map(l => l.slice(0, 7)));
      }
    }
  });

  it.each([0, 5, 40, 1000])('keeps buffer and cursor bounds with a %i-line history limit', async scrollback => {
    const t = terminal(scrollback);
    await write(t, ('long line '.repeat(16) + '\r\n').repeat(120));
    for (let i = 0; i < 30; i++) {
      resizeConptyTerminal(t, 20 + (i * 37) % 130, 3 + (i * 13) % 45);
      invariants(t);
      await write(t, `output ${i}\r\n`);
      invariants(t);
    }
  });

  it('preserves real duplicate output, blank rows and attributes', async () => {
    const t = terminal();
    await write(t, '\x1b[31mREPEATED\r\n\r\nREPEATED\x1b[m\r\n' + 'wrap '.repeat(40) + '\r\n');
    for (const cols of [60, 100, 40, 100]) resizeConptyTerminal(t, cols, 35);
    expect(text(t)).toContain('REPEATED\n\nREPEATED');
    expect(t.buffer.normal.getLine(0)?.getCell(0)?.getFgColor()).toBe(1);
    invariants(t);
  });

  it('leaves alternate-screen resize to xterm and restores normal history', async () => {
    const t = terminal();
    await write(t, 'NORMAL_HISTORY\r\n\x1b[?1049hFULLSCREEN');
    resizeConptyTerminal(t, 60, 20);
    expect(t.buffer.active.type).toBe('alternate');
    await write(t, '\x1b[?1049l');
    expect(text(t)).toContain('NORMAL_HISTORY');
    invariants(t);
  });
});
