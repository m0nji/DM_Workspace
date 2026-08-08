// Gemeinsame, dünne Datei-Zugriffs-Schicht für die Files-/Editor-Panels
// (Arbeitspaket B3): lokale Workspaces laufen wie bisher über die fs:*-Kanäle
// (window.api.readDir & Co.), Remote-Workspaces über die remoteFs:*-Kanäle
// gegen die REST-API des Servers. Die Panels arbeiten nur gegen dieses
// Interface und bleiben dadurch von der Herkunft der Dateien unabhängig.
//
// Pfad-Konvention der Remote-Variante: '/'-gerootete Projektpfade ('/' =
// Projektroot, '/src/app.ts' = Datei im Projekt). Damit funktionieren die
// vorhandenen Pfad-Helfer (breadcrumbSegments, parentDir, isFsRoot, basename)
// unverändert; erst an der IPC-Grenze wird der führende Slash entfernt
// (der Server erwartet relative Pfade, '' = Root).

import type { CreateFileResult, DirEntry, RemoteFsErrorCode } from '../shared/types';

export interface RemoteFilesContext {
  serverId: string;
  projectId: string;
}

// Fehlercodes, die die Panels gezielt anzeigen. 'binary'/'too-large' decken
// sich mit den lokalen ReadTextResult-Codes, der Rest kommt aus der Remote-
// Fehlerabbildung (shared/types.ts, RemoteFsErrorCode).
export type FilesErrorCode =
  | 'binary' | 'too-large'
  | 'not-logged-in' | 'forbidden' | 'not-found' | 'network' | 'server';

export type FilesReadResult =
  | { ok: true; content: string; mtime?: number }
  | { ok: false; code: FilesErrorCode };

export type FilesWriteResult =
  | { ok: true; mtime?: number }
  | { ok: false; code: FilesErrorCode | 'conflict'; serverMtime?: number };

export interface FilesApi {
  /** null = lokaler Workspace; sonst die (Server, Projekt)-Herkunft. */
  readonly remote: RemoteFilesContext | null;
  /** Verzeichnis lesen; wirft bei Fehlern (UI zeigt die generische Meldung). */
  readDir(path: string): Promise<DirEntry[]>;
  readTextFile(path: string): Promise<FilesReadResult>;
  /**
   * Datei schreiben. baseMtime (aus readTextFile bzw. dem letzten Schreiben)
   * aktiviert das serverseitige optimistic Locking: 'conflict' heißt, die
   * Datei wurde zwischenzeitlich auf dem Server geändert. Ohne baseMtime wird
   * bedingungslos geschrieben („Überschreiben"). Lokal gibt es kein Locking.
   */
  writeTextFile(path: string, content: string, baseMtime?: number): Promise<FilesWriteResult>;
  createFile(dir: string, name: string): Promise<CreateFileResult>;
  /** Löschen; wirft bei Fehlern (UI zeigt die generische Meldung). */
  deletePath(path: string): Promise<void>;
  /** Pfad, wie er in ein Terminal gehört (Remote: Container-Sicht /workspace). */
  terminalPath(path: string): string;
}

// Panel-Pfad ('/x/y') -> Server-Pfad ('x/y', '' = Root).
function toServerPath(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

function joinPath(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

// Remote-Fehlercodes auf die Panel-Codes eindampfen: was keinen eigenen
// UI-Zweig hat, wird zum generischen Serverfehler.
function toFilesError(code: RemoteFsErrorCode): FilesErrorCode {
  switch (code) {
    case 'binary':
    case 'too-large':
    case 'not-logged-in':
    case 'forbidden':
    case 'not-found':
    case 'network':
      return code;
    default:
      return 'server';
  }
}

const localFilesApi: FilesApi = {
  remote: null,
  readDir: (path) => window.api.readDir(path),
  readTextFile: async (path) => {
    const res = await window.api.readTextFile(path);
    return res.ok ? { ok: true, content: res.content } : { ok: false, code: res.code };
  },
  writeTextFile: async (path, content) => {
    try {
      await window.api.writeTextFile(path, content);
      return { ok: true };
    } catch {
      return { ok: false, code: 'server' };
    }
  },
  createFile: (dir, name) => window.api.createFile(dir, name),
  deletePath: (path) => window.api.deletePath(path),
  terminalPath: (path) => path
};

// Dieselbe Namensprüfung wie fs-browser.ts (createFile) — die Remote-Variante
// braucht sie lokal, weil der Server kein eigenes „exists/invalid-name" kennt.
function isValidFileName(name: string): boolean {
  return !!name && !name.includes('/') && !name.includes('\\') &&
    name !== '.' && name !== '..' && !name.includes('\0');
}

function createRemoteFilesApi(remote: RemoteFilesContext): FilesApi {
  const { serverId, projectId } = remote;
  return {
    remote,
    readDir: async (path) => {
      const res = await window.api.remoteFsList(serverId, projectId, toServerPath(path));
      if (!res.ok) throw new Error(res.message ?? res.code);
      const base = path === '/' || path === '' ? '/' : path.replace(/\/+$/, '');
      return res.entries.map((e): DirEntry => ({
        name: e.name,
        path: joinPath(base, e.name),
        isDir: e.isDir,
        size: e.size,
        mtimeMs: e.mtimeMs
      }));
    },
    readTextFile: async (path) => {
      const res = await window.api.remoteFsRead(serverId, projectId, toServerPath(path));
      if (!res.ok) return { ok: false, code: toFilesError(res.code) };
      return { ok: true, content: res.content, mtime: res.mtime };
    },
    writeTextFile: async (path, content, baseMtime) => {
      const res = await window.api.remoteFsWrite(serverId, projectId, toServerPath(path), content, baseMtime);
      if (!res.ok) {
        if (res.code === 'conflict') return { ok: false, code: 'conflict', serverMtime: res.serverMtime };
        return { ok: false, code: toFilesError(res.code) };
      }
      return { ok: true, mtime: res.mtime };
    },
    createFile: async (dir, name) => {
      if (!isValidFileName(name)) return { ok: false, code: 'invalid-name' };
      const path = joinPath(dir === '' ? '/' : dir, name);
      // Der Server kennt kein exklusives Anlegen; ein Lese-Vorabcheck deckt den
      // Normalfall ab: existiert die Datei (auch als binär/zu groß gemeldete),
      // wird nicht angelegt. Andere Fehler (nicht angemeldet, Netz, verboten)
      // werfen und landen in der generischen Anlegen-Fehlermeldung des Panels.
      const existing = await window.api.remoteFsRead(serverId, projectId, toServerPath(path));
      if (existing.ok || existing.code === 'binary' || existing.code === 'too-large') {
        return { ok: false, code: 'exists' };
      }
      if (existing.code !== 'not-found') throw new Error(existing.message ?? existing.code);
      const res = await window.api.remoteFsWrite(serverId, projectId, toServerPath(path), '');
      if (!res.ok) throw new Error(res.message ?? res.code);
      return { ok: true, path };
    },
    deletePath: async (path) => {
      const res = await window.api.remoteFsDelete(serverId, projectId, toServerPath(path));
      if (!res.ok) throw new Error(res.message ?? res.code);
    },
    // Der Projektroot ist im Container /workspace (Server-Konvention) — ein in
    // ein Remote-Terminal gezogener Pfad muss die Container-Sicht tragen.
    terminalPath: (path) => `/workspace${path === '/' ? '' : path}`
  };
}

export function createFilesApi(remote: RemoteFilesContext | null): FilesApi {
  return remote ? createRemoteFilesApi(remote) : localFilesApi;
}
