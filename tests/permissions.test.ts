import { describe, it, expect } from 'vitest';
import { installPermissionGuards, type PermissionSession } from '../src/main/permissions';

function stubSession(): PermissionSession & {
  request: (permission: string) => boolean;
  check: (permission: string) => boolean;
} {
  let requestHandler: Parameters<PermissionSession['setPermissionRequestHandler']>[0] = null;
  let checkHandler: Parameters<PermissionSession['setPermissionCheckHandler']>[0] = null;
  return {
    setPermissionRequestHandler: (h) => { requestHandler = h; },
    setPermissionCheckHandler: (h) => { checkHandler = h; },
    request: (permission) => {
      let granted: boolean | undefined;
      requestHandler?.(null, permission, (allowed) => { granted = allowed; });
      return granted!;
    },
    check: (permission) => checkHandler?.(null, permission) ?? true
  };
}

describe('installPermissionGuards', () => {
  // Without a handler Electron decides on its own, and a page loaded into the
  // preview <webview> is untrusted content — a link an agent or a build script
  // printed into the terminal. The app itself asks for nothing: clipboard goes
  // through IPC to the main process, notifications are raised there too. So
  // anything asking is embedded content, and everything is denied.
  it('denies every permission request', () => {
    const ses = stubSession();
    installPermissionGuards(ses);
    for (const permission of ['geolocation', 'notifications', 'clipboard-read', 'media', 'midi']) {
      expect(ses.request(permission)).toBe(false);
    }
  });

  it('denies the synchronous permission checks too', () => {
    const ses = stubSession();
    installPermissionGuards(ses);
    for (const permission of ['geolocation', 'clipboard-read', 'media']) {
      expect(ses.check(permission)).toBe(false);
    }
  });
});
