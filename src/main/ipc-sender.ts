// Origin check for every IPC message the main process serves.
//
// The channels registered in ipc.ts cover the whole machine — fs:delete,
// fs:writeText, pty:spawn. Only the app's own renderer is meant to reach them,
// and today only it can: attached <webview>s have their preload removed and run
// sandboxed (index.ts), so they hold no ipcRenderer. That is the entire defence,
// it lives in one line, and nothing checks it. A preload added to a webview
// later — for a plugin, a devtools helper — would open every channel at once to
// whatever page that webview happens to be showing, with no error anywhere.
//
// So the assumption is checked instead of assumed. Frame identity rather than
// URL: Electron hands out one WebFrameMain per frame, so a webview or an iframe
// is a different object even when it renders the very same file:// URL that the
// app itself loads.
export function isTrustedSender(senderFrame: unknown, windowMainFrame: unknown): boolean {
  if (senderFrame == null || windowMainFrame == null) return false;
  return senderFrame === windowMainFrame;
}
