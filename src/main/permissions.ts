// Permission policy for every session in the app.
//
// The preview panel renders links the user clicked in a terminal — an address a
// build script, a log line or an agent printed, i.e. untrusted content — inside
// a <webview>. Without a handler installed, Electron answers permission
// requests from that page on its own, so it could ask for geolocation,
// notifications or clipboard-read and be granted without the app ever having a
// say. Sandbox and contextIsolation do not cover this: they stop code from
// reaching the host, not a page from asking the browser for data about the user.
//
// The app itself needs no web permission — clipboard access goes through IPC to
// the main process, and notifications are raised there as well — so anything
// asking is embedded content and everything is refused. Typed structurally
// rather than against Electron's Session so this stays unit-testable.
export interface PermissionSession {
  setPermissionRequestHandler(
    handler: ((webContents: unknown, permission: string, callback: (granted: boolean) => void) => void) | null
  ): void;
  setPermissionCheckHandler(
    handler: ((webContents: unknown, permission: string) => boolean) | null
  ): void;
}

export function installPermissionGuards(ses: PermissionSession): void {
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}
