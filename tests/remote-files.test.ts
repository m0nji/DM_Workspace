import { describe, expect, it, vi } from 'vitest';
import { MAX_REMOTE_FILE_BYTES, RemoteFiles, type RemoteFilesDeps } from '../src/main/remote/remote-files';

// REST-Client der Remote-Datei-API (B3): fetch ist gemockt; geprüft werden
// URL-/Pfad-Mapping, Cookie-Header und die Abbildung der HTTP-Statuscodes auf
// den strukturierten Fehlerkatalog (401 -> not-logged-in, 409 -> conflict …).

const BASE = 'https://dmw.example';
const SRV = 'srv1';
const PROJ = 'proj-123';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body)
  } as unknown as Response;
}

function makeFiles(fetchFn: ReturnType<typeof vi.fn>, cookie: string | null = 'dmw_session=tok'): RemoteFiles {
  const deps: RemoteFilesDeps = {
    resolve: (serverId) => (serverId === SRV ? { baseUrl: BASE, cookie } : null),
    fetchFn: fetchFn as unknown as typeof fetch
  };
  return new RemoteFiles(deps);
}

describe('RemoteFiles.list', () => {
  it('ruft die files-Route mit encodetem Pfad + Cookie auf und mappt die Einträge', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, {
      entries: [
        { name: 'src', type: 'dir', size: 4096, mtime: 1700000000 },
        { name: 'a b.txt', type: 'file', size: 12, mtime: 1700000100 }
      ]
    }));
    const res = await makeFiles(fetchFn).list(SRV, PROJ, 'src/sub dir');

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/api/projects/${PROJ}/files?path=${encodeURIComponent('src/sub dir')}`,
      expect.objectContaining({ method: 'GET', headers: expect.objectContaining({ Cookie: 'dmw_session=tok' }) })
    );
    expect(res).toEqual({
      ok: true,
      entries: [
        { name: 'src', isDir: true, size: 4096, mtimeMs: 1700000000 * 1000 },
        { name: 'a b.txt', isDir: false, size: 12, mtimeMs: 1700000100 * 1000 }
      ]
    });
  });

  it('meldet not-logged-in ohne Netzaufruf, wenn kein Session-Token vorliegt', async () => {
    const fetchFn = vi.fn();
    const res = await makeFiles(fetchFn, null).list(SRV, PROJ, '');
    expect(res).toEqual({ ok: false, code: 'not-logged-in' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('meldet einen unbekannten Server als Serverfehler', async () => {
    const fetchFn = vi.fn();
    const res = await makeFiles(fetchFn).list('nope', PROJ, '');
    expect(res).toMatchObject({ ok: false, code: 'server' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('mappt 404 auf not-found und reicht die Servermeldung durch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(404, { error: 'Verzeichnis nicht gefunden' }));
    const res = await makeFiles(fetchFn).list(SRV, PROJ, 'missing');
    expect(res).toEqual({ ok: false, code: 'not-found', message: 'Verzeichnis nicht gefunden' });
  });

  it('mappt einen Netzwerkfehler auf network', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    const res = await makeFiles(fetchFn).list(SRV, PROJ, '');
    expect(res).toEqual({ ok: false, code: 'network', message: 'fetch failed' });
  });
});

describe('RemoteFiles.read', () => {
  it('liefert Inhalt + mtime der file-Route', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { content: 'hallo', mtime: 1700000000, size: 5 }));
    const res = await makeFiles(fetchFn).read(SRV, PROJ, 'README.md');
    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/api/projects/${PROJ}/file?path=README.md`,
      expect.objectContaining({ method: 'GET' })
    );
    expect(res).toEqual({ ok: true, content: 'hallo', mtime: 1700000000, size: 5 });
  });

  it('mappt 401 auf not-logged-in und 413/415 auf too-large/binary', async () => {
    const files = makeFiles(vi.fn().mockResolvedValueOnce(jsonResponse(401, { error: 'Nicht angemeldet' }))
      .mockResolvedValueOnce(jsonResponse(413, { error: 'Datei zu groß für den Editor' }))
      .mockResolvedValueOnce(jsonResponse(415, { error: 'Datei ist nicht UTF-8-kodiert (binär?)' })));
    expect(await files.read(SRV, PROJ, 'x')).toMatchObject({ ok: false, code: 'not-logged-in' });
    expect(await files.read(SRV, PROJ, 'x')).toMatchObject({ ok: false, code: 'too-large' });
    expect(await files.read(SRV, PROJ, 'x')).toMatchObject({ ok: false, code: 'binary' });
  });
});

describe('RemoteFiles.write', () => {
  it('schickt Pfad, Inhalt und baseMtime als PUT und liefert die neue mtime', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { mtime: 1700000200 }));
    const res = await makeFiles(fetchFn).write(SRV, PROJ, 'notes.md', 'neu', 1700000100);

    expect(fetchFn).toHaveBeenCalledWith(
      `${BASE}/api/projects/${PROJ}/file`,
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ path: 'notes.md', content: 'neu', baseMtime: 1700000100 })
      })
    );
    expect(res).toEqual({ ok: true, mtime: 1700000200 });
  });

  it('lässt baseMtime beim Überschreiben weg', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { mtime: 1 }));
    await makeFiles(fetchFn).write(SRV, PROJ, 'notes.md', 'neu');
    const body = JSON.parse((fetchFn.mock.calls[0][1] as { body: string }).body) as Record<string, unknown>;
    expect('baseMtime' in body).toBe(false);
  });

  it('mappt 409 auf conflict und schlägt die Server-mtime im Eltern-Listing nach', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Datei wurde zwischenzeitlich geändert' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        entries: [{ name: 'notes.md', type: 'file', size: 9, mtime: 1700000999 }]
      }));
    const res = await makeFiles(fetchFn).write(SRV, PROJ, 'docs/notes.md', 'neu', 1700000100);

    expect(res).toEqual({
      ok: false, code: 'conflict',
      message: 'Datei wurde zwischenzeitlich geändert',
      serverMtime: 1700000999
    });
    // Zweiter Aufruf war das Listing des Elternordners.
    expect(fetchFn.mock.calls[1][0]).toBe(`${BASE}/api/projects/${PROJ}/files?path=docs`);
  });

  it('bleibt beim Konflikt auch ohne auffindbare Server-mtime ein conflict', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse(409, { error: 'Konflikt' }))
      .mockResolvedValueOnce(jsonResponse(404, { error: 'weg' }));
    const res = await makeFiles(fetchFn).write(SRV, PROJ, 'notes.md', 'neu', 1);
    expect(res).toEqual({ ok: false, code: 'conflict', message: 'Konflikt' });
  });

  it('lehnt Inhalte über dem 1-MB-Server-Limit lokal ab (kein Netzaufruf)', async () => {
    const fetchFn = vi.fn();
    const big = 'x'.repeat(MAX_REMOTE_FILE_BYTES + 1);
    const res = await makeFiles(fetchFn).write(SRV, PROJ, 'big.txt', big);
    expect(res).toEqual({ ok: false, code: 'too-large' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('mappt 403 (Viewer) auf forbidden', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'Viewer haben nur Lesezugriff' }));
    const res = await makeFiles(fetchFn).write(SRV, PROJ, 'x.txt', 'y');
    expect(res).toMatchObject({ ok: false, code: 'forbidden', message: 'Viewer haben nur Lesezugriff' });
  });
});

describe('RemoteFiles mkdir/remove/rename', () => {
  it('ruft die jeweiligen POST-Routen auf und meldet ok', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const files = makeFiles(fetchFn);

    expect(await files.mkdir(SRV, PROJ, 'neu')).toEqual({ ok: true });
    expect(await files.remove(SRV, PROJ, 'alt.txt')).toEqual({ ok: true });
    expect(await files.rename(SRV, PROJ, 'a.txt', 'b.txt')).toEqual({ ok: true });

    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      `${BASE}/api/projects/${PROJ}/files/mkdir`,
      `${BASE}/api/projects/${PROJ}/files/delete`,
      `${BASE}/api/projects/${PROJ}/files/rename`
    ]);
    expect(JSON.parse((fetchFn.mock.calls[2][1] as { body: string }).body)).toEqual({ from: 'a.txt', to: 'b.txt' });
  });

  it('reicht 403 beim Löschen als forbidden durch', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(403, { error: 'Viewer haben nur Lesezugriff' }));
    expect(await makeFiles(fetchFn).remove(SRV, PROJ, 'x')).toMatchObject({ ok: false, code: 'forbidden' });
  });
});
