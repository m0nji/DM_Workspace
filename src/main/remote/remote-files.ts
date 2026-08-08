// Remote-Dateizugriff (Arbeitspaket B3, Plan 4.4 „remote-files.ts"):
// dünner, authentifizierter REST-Client gegen die Datei-API des
// Workspace-Servers (files/routes.ts in dm_workspace_web). Base-URL und
// Session-Cookie liefert der RemoteManager (Serverliste + AuthManager) über
// die injizierte resolve-Funktion — Tokens verlassen den Main-Prozess nie.
//
// Fehler werden auf strukturierte Ergebnisse abgebildet statt zu werfen
// (RemoteFsError in shared/types.ts): die IPC-Handler reichen sie unverändert
// an den Renderer durch, der gezielt reagiert (401 -> „nicht angemeldet",
// 409 -> Konflikthinweis mit Neu-laden/Überschreiben, 413 -> Limit-Meldung).

import type {
  RemoteFsEntry, RemoteFsError, RemoteFsErrorCode, RemoteFsListResult,
  RemoteFsOkResult, RemoteFsReadResult, RemoteFsWriteResult
} from '../../shared/types';

// Server-Limit für Editor-Dateien (config.maxFileBytes in dm_workspace_web).
// Wird vor dem Upload lokal geprüft, damit ein zu großer Inhalt gar nicht erst
// über das (ggf. langsame) VPN geschickt wird.
export const MAX_REMOTE_FILE_BYTES = 1024 * 1024;

export interface RemoteFilesDeps {
  /** Base-URL + Session-Cookie eines Servers; null bei unbekanntem Server. */
  resolve: (serverId: string) => { baseUrl: string; cookie: string | null } | null;
  fetchFn?: typeof fetch;
}

function codeForStatus(status: number): RemoteFsErrorCode {
  switch (status) {
    case 400: return 'invalid-path';
    case 401: return 'not-logged-in';
    case 403: return 'forbidden';
    case 404: return 'not-found';
    case 409: return 'conflict';
    case 413: return 'too-large';
    case 415: return 'binary';
    default: return 'server';
  }
}

type RequestResult =
  | { ok: true; body: Record<string, unknown> }
  | RemoteFsError;

export class RemoteFiles {
  constructor(private readonly deps: RemoteFilesDeps) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  // Gemeinsamer Unterbau aller Operationen: Server auflösen, Cookie anhängen,
  // Statuscode auf den Fehlerkatalog abbilden. Die Servermeldung (body.error)
  // wird mitgegeben, damit die UI sie 1:1 anzeigen kann.
  private async request(
    serverId: string, method: 'GET' | 'PUT' | 'POST', apiPath: string, body?: unknown
  ): Promise<RequestResult> {
    const resolved = this.deps.resolve(serverId);
    if (!resolved) return { ok: false, code: 'server', message: `unknown remote server: ${serverId}` };
    if (!resolved.cookie) return { ok: false, code: 'not-logged-in' };
    let res: Response;
    try {
      res = await this.fetchFn(`${resolved.baseUrl}${apiPath}`, {
        method,
        headers: {
          Cookie: resolved.cookie,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
      });
    } catch (err) {
      return { ok: false, code: 'network', message: err instanceof Error ? err.message : String(err) };
    }
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error: RemoteFsError = { ok: false, code: codeForStatus(res.status) };
      if (typeof parsed.error === 'string' && parsed.error) error.message = parsed.error;
      return error;
    }
    return { ok: true, body: parsed };
  }

  private fileUrl(projectId: string, endpoint: string, path?: string): string {
    const base = `/api/projects/${encodeURIComponent(projectId)}${endpoint}`;
    return path === undefined ? base : `${base}?path=${encodeURIComponent(path)}`;
  }

  async list(serverId: string, projectId: string, path: string): Promise<RemoteFsListResult> {
    const res = await this.request(serverId, 'GET', this.fileUrl(projectId, '/files', path));
    if (!res.ok) return res;
    const raw = Array.isArray(res.body.entries) ? res.body.entries : [];
    const entries = raw.flatMap((e): RemoteFsEntry[] => {
      if (typeof e !== 'object' || e === null) return [];
      const r = e as Record<string, unknown>;
      if (typeof r.name !== 'string' || !r.name) return [];
      return [{
        name: r.name,
        isDir: r.type === 'dir',
        size: typeof r.size === 'number' ? r.size : 0,
        // Server liefert Sekunden (find %T@ / stat %Y); DirEntry erwartet ms.
        mtimeMs: (typeof r.mtime === 'number' ? r.mtime : 0) * 1000
      }];
    });
    return { ok: true, entries };
  }

  async read(serverId: string, projectId: string, path: string): Promise<RemoteFsReadResult> {
    const res = await this.request(serverId, 'GET', this.fileUrl(projectId, '/file', path));
    if (!res.ok) return res;
    const { content, mtime, size } = res.body;
    if (typeof content !== 'string' || typeof mtime !== 'number') {
      return { ok: false, code: 'server', message: 'Unerwartete Server-Antwort' };
    }
    return { ok: true, content, mtime, size: typeof size === 'number' ? size : content.length };
  }

  // Optimistic Locking: baseMtime ist die beim Lesen erhaltene mtime; ist die
  // Datei auf dem Server inzwischen neuer, antwortet er mit 409. Ohne baseMtime
  // wird bedingungslos geschrieben (die „Überschreiben"-Aktion des Konflikts).
  async write(
    serverId: string, projectId: string, path: string, content: string, baseMtime?: number
  ): Promise<RemoteFsWriteResult> {
    if (Buffer.byteLength(content, 'utf8') > MAX_REMOTE_FILE_BYTES) {
      return { ok: false, code: 'too-large' };
    }
    const body: Record<string, unknown> = { path, content };
    if (baseMtime !== undefined) body.baseMtime = baseMtime;
    const res = await this.request(serverId, 'PUT', this.fileUrl(projectId, '/file'), body);
    if (!res.ok) {
      // Beim Konflikt die aktuelle Server-mtime nachschlagen (billig über das
      // Eltern-Listing statt eines vollen Reads) — rein informativ, ein Fehler
      // dabei ändert nichts am Konfliktergebnis.
      if (res.code === 'conflict') {
        const serverMtime = await this.lookupMtime(serverId, projectId, path);
        if (serverMtime !== null) return { ...res, serverMtime };
      }
      return res;
    }
    const mtime = res.body.mtime;
    if (typeof mtime !== 'number') return { ok: false, code: 'server', message: 'Unerwartete Server-Antwort' };
    return { ok: true, mtime };
  }

  private async lookupMtime(serverId: string, projectId: string, path: string): Promise<number | null> {
    const segments = path.split('/').filter(Boolean);
    const name = segments.pop();
    if (!name) return null;
    const listed = await this.list(serverId, projectId, segments.join('/'));
    if (!listed.ok) return null;
    const entry = listed.entries.find((e) => e.name === name);
    return entry ? Math.floor(entry.mtimeMs / 1000) : null;
  }

  async mkdir(serverId: string, projectId: string, path: string): Promise<RemoteFsOkResult> {
    const res = await this.request(serverId, 'POST', this.fileUrl(projectId, '/files/mkdir'), { path });
    return res.ok ? { ok: true } : res;
  }

  async remove(serverId: string, projectId: string, path: string): Promise<RemoteFsOkResult> {
    const res = await this.request(serverId, 'POST', this.fileUrl(projectId, '/files/delete'), { path });
    return res.ok ? { ok: true } : res;
  }

  async rename(serverId: string, projectId: string, from: string, to: string): Promise<RemoteFsOkResult> {
    const res = await this.request(serverId, 'POST', this.fileUrl(projectId, '/files/rename'), { from, to });
    return res.ok ? { ok: true } : res;
  }
}
