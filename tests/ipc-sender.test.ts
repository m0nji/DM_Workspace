import { describe, it, expect } from 'vitest';
import { isTrustedSender } from '../src/main/ipc-sender';

// The IPC surface hands out the whole machine: fs:delete, fs:writeText,
// pty:spawn. Today only the app's own window can reach it, because attached
// <webview>s are stripped of their preload and therefore have no ipcRenderer —
// an assumption that lives in one line of index.ts and nothing checks. These
// tests pin it: a message is served only when it comes from the window's own
// top-level frame.
describe('isTrustedSender', () => {
  const mainFrame = { url: 'file:///app/renderer/index.html' };

  it('accepts the window main frame', () => {
    expect(isTrustedSender(mainFrame, mainFrame)).toBe(true);
  });

  it('rejects any other frame, however similar it looks', () => {
    // A webview or iframe: a different frame object, even with the same URL.
    expect(isTrustedSender({ url: 'file:///app/renderer/index.html' }, mainFrame)).toBe(false);
    expect(isTrustedSender({ url: 'https://attacker.example/' }, mainFrame)).toBe(false);
  });

  // senderFrame is null when the frame was disposed between send and dispatch.
  it('rejects a missing sender', () => {
    expect(isTrustedSender(null, mainFrame)).toBe(false);
    expect(isTrustedSender(undefined, mainFrame)).toBe(false);
  });

  // No window (closing, or not created yet) means there is no frame that could
  // legitimately be talking to us.
  it('rejects everything when there is no window frame to compare against', () => {
    expect(isTrustedSender(mainFrame, null)).toBe(false);
    expect(isTrustedSender(null, null)).toBe(false);
  });
});
