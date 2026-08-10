import { app, ipcMain, type BrowserWindow } from 'electron';
import electronUpdater from 'electron-updater';
import type { UpdateEvent } from '../shared/types';

const { autoUpdater } = electronUpdater;

// Repo the releases live in (mirrors build.publish in package.json). Used to fetch
// the release notes shown in the update dialog.
const RELEASES_REPO = 'm0nji/DM_Workspace';

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { Accept: accept, 'User-Agent': 'DM-Workspace' } });
    return res.ok ? res : null;
  } catch {
    return null; // offline, DNS, TLS — the update itself stays available
  }
}

// CHANGELOG.md as it stands at the release's tag (public repo — no auth). It
// lists EVERY version, which is what lets the dialog show the whole span an
// upgrade covers: someone on 0.10.0 who skipped 0.11.0 should see that version's
// changes too. Which sections to show is decided in the renderer, which knows the
// installed version.
async function fetchTaggedChangelog(tag: string): Promise<string | null> {
  const res = await get(`https://raw.githubusercontent.com/${RELEASES_REPO}/${tag}/CHANGELOG.md`, 'text/plain');
  const body = await res?.text().catch(() => null);
  return body?.trim() ? body : null;
}

// Fallback: the GitHub release body, which only ever holds its own version's
// section (publish-release.sh cuts it out of CHANGELOG.md).
async function fetchReleaseBody(tag: string): Promise<string | null> {
  const res = await get(`https://api.github.com/repos/${RELEASES_REPO}/releases/tags/${tag}`, 'application/vnd.github+json');
  const data = (await res?.json().catch(() => null)) as { body?: unknown } | null;
  return typeof data?.body === 'string' && data.body.trim() ? data.body : null;
}

async function fetchUpdateNotes(version: string): Promise<string | null> {
  const tag = version.startsWith('v') ? version : `v${version}`;
  return (await fetchTaggedChangelog(tag)) ?? (await fetchReleaseBody(tag));
}

/**
 * Wire electron-updater to the renderer. Updates only work in the packaged,
 * code-signed app published to GitHub Releases; in dev we report 'disabled'.
 *
 * Flow: renderer triggers `updates:check` on startup (and from Settings). When an
 * update is available the user clicks to download; once downloaded we install
 * immediately (relaunch) so it's a single "download & install" action.
 */
export function registerUpdater(getWindow: () => BrowserWindow | null): void {
  const enabled = app.isPackaged;
  const send = (e: UpdateEvent) => getWindow()?.webContents.send('updates:event', e);
  const errMessage = (err: unknown): string =>
    (err instanceof Error ? err.message : String(err)) || 'Unknown error';

  autoUpdater.autoDownload = false;        // wait for the user to click
  autoUpdater.autoInstallOnAppQuit = true; // safety net if not installed eagerly

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }));
  autoUpdater.on('update-available', (info) => send({ type: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => send({ type: 'not-available' }));
  autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    send({ type: 'downloaded', version: info.version });
    autoUpdater.quitAndInstall();
  });
  autoUpdater.on('error', (err) => send({ type: 'error', message: errMessage(err) }));

  ipcMain.on('updates:check', () => {
    if (!enabled) { send({ type: 'disabled' }); return; }
    autoUpdater.checkForUpdates().catch((err) => send({ type: 'error', message: errMessage(err) }));
  });
  ipcMain.on('updates:download', () => {
    if (!enabled) return;
    autoUpdater.downloadUpdate().catch((err) => send({ type: 'error', message: errMessage(err) }));
  });
  ipcMain.on('updates:install', () => {
    if (enabled) autoUpdater.quitAndInstall();
  });
  ipcMain.handle('updates:notes', (_e, version: string) => fetchUpdateNotes(version));
}
