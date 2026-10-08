import { fileURLToPath } from 'node:url';
import { isAllowedPreviewUrl } from '../shared/link-detect';

interface OpenInBrowserServices {
  platform: NodeJS.Platform;
  openExternal(url: string): Promise<void>;
  isFile(path: string): boolean;
  /** macOS: bundle path of the app registered for https:, or null. */
  defaultBrowserApp(): Promise<string | null>;
  openWithApp(app: string, path: string): Promise<void>;
}

// "Im Browser öffnen" from the terminal link menu. The URL comes from untrusted
// terminal output, so only http(s) and local, existing .html/.htm files pass —
// the same UNC/remote-host refusal the preview webview applies (see
// isAllowedPreviewUrl). Returns whether anything was opened.
export function createOpenInBrowser(services: OpenInBrowserServices) {
  return async (raw: unknown): Promise<boolean> => {
    if (typeof raw !== 'string' || !isAllowedPreviewUrl(raw)) return false;
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await services.openExternal(url.href);
      return true;
    }
    const path = fileURLToPath(url);
    if (!/\.html?$/i.test(path) || !services.isFile(path)) return false;
    // macOS opens a file: URL with the .html file handler, which is often an
    // editor — hand it to the https: handler (the default browser) instead.
    if (services.platform === 'darwin') {
      const app = await services.defaultBrowserApp();
      if (app) { await services.openWithApp(app, path); return true; }
    }
    await services.openExternal(url.href);
    return true;
  };
}
