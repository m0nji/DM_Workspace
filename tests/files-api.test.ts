import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFilesApi } from '../src/renderer/files-api';

// Die dünne Abstraktion der Files-/Editor-Panels: lokal muss sie 1:1 auf die
// fs:*-Fassade (window.api) durchreichen, remote auf die remoteFs:*-Fassade —
// inkl. Pfad-Übersetzung ('/'-gerootete Panel-Pfade <-> relative Serverpfade).

const REMOTE = { serverId: 'srv1', projectId: 'proj1' };

interface ApiMock {
  readDir: ReturnType<typeof vi.fn>;
  readTextFile: ReturnType<typeof vi.fn>;
  writeTextFile: ReturnType<typeof vi.fn>;
  createFile: ReturnType<typeof vi.fn>;
  deletePath: ReturnType<typeof vi.fn>;
  remoteFsList: ReturnType<typeof vi.fn>;
  remoteFsRead: ReturnType<typeof vi.fn>;
  remoteFsWrite: ReturnType<typeof vi.fn>;
  remoteFsDelete: ReturnType<typeof vi.fn>;
}

let api: ApiMock;

beforeEach(() => {
  api = {
    readDir: vi.fn().mockResolvedValue([]),
    readTextFile: vi.fn().mockResolvedValue({ ok: true, content: 'lokal' }),
    writeTextFile: vi.fn().mockResolvedValue(undefined),
    createFile: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/x.txt' }),
    deletePath: vi.fn().mockResolvedValue(undefined),
    remoteFsList: vi.fn().mockResolvedValue({ ok: true, entries: [] }),
    remoteFsRead: vi.fn().mockResolvedValue({ ok: true, content: 'remote', mtime: 100, size: 6 }),
    remoteFsWrite: vi.fn().mockResolvedValue({ ok: true, mtime: 101 }),
    remoteFsDelete: vi.fn().mockResolvedValue({ ok: true })
  };
  (globalThis as unknown as { window: unknown }).window = { api };
});

describe('createFilesApi – lokaler Dispatch', () => {
  it('reicht readDir/readTextFile/createFile/deletePath an window.api durch', async () => {
    const files = createFilesApi(null);
    expect(files.remote).toBeNull();

    await files.readDir('/tmp/proj');
    expect(api.readDir).toHaveBeenCalledWith('/tmp/proj');

    const read = await files.readTextFile('/tmp/a.txt');
    expect(api.readTextFile).toHaveBeenCalledWith('/tmp/a.txt');
    expect(read).toEqual({ ok: true, content: 'lokal' });

    await files.createFile('/tmp', 'neu.txt');
    expect(api.createFile).toHaveBeenCalledWith('/tmp', 'neu.txt');

    await files.deletePath('/tmp/a.txt');
    expect(api.deletePath).toHaveBeenCalledWith('/tmp/a.txt');

    expect(api.remoteFsList).not.toHaveBeenCalled();
    expect(api.remoteFsRead).not.toHaveBeenCalled();
  });

  it('writeTextFile meldet ok ohne mtime (lokal gibt es kein Locking)', async () => {
    const files = createFilesApi(null);
    expect(await files.writeTextFile('/tmp/a.txt', 'x', 123)).toEqual({ ok: true });
    // baseMtime wird lokal ignoriert — die fs-Fassade kennt den Parameter nicht.
    expect(api.writeTextFile).toHaveBeenCalledWith('/tmp/a.txt', 'x');
  });

  it('writeTextFile mappt einen Throw auf den generischen Serverfehler', async () => {
    api.writeTextFile.mockRejectedValue(new Error('EACCES'));
    const files = createFilesApi(null);
    expect(await files.writeTextFile('/tmp/a.txt', 'x')).toEqual({ ok: false, code: 'server' });
  });

  it('terminalPath ist lokal die Identität', () => {
    expect(createFilesApi(null).terminalPath('/tmp/a.txt')).toBe('/tmp/a.txt');
  });
});

describe('createFilesApi – Remote-Dispatch', () => {
  it('readDir übersetzt den Panel-Pfad und baut DirEntry-Pfade unterhalb auf', async () => {
    api.remoteFsList.mockResolvedValue({
      ok: true,
      entries: [
        { name: 'src', isDir: true, size: 0, mtimeMs: 1000 },
        { name: 'a.txt', isDir: false, size: 3, mtimeMs: 2000 }
      ]
    });
    const files = createFilesApi(REMOTE);
    expect(files.remote).toEqual(REMOTE);

    const root = await files.readDir('/');
    expect(api.remoteFsList).toHaveBeenCalledWith('srv1', 'proj1', '');
    expect(root.map((e) => e.path)).toEqual(['/src', '/a.txt']);

    await files.readDir('/src/sub');
    expect(api.remoteFsList).toHaveBeenLastCalledWith('srv1', 'proj1', 'src/sub');
    expect(api.readDir).not.toHaveBeenCalled();
  });

  it('readDir wirft bei einem Fehlerergebnis (UI zeigt die generische Meldung)', async () => {
    api.remoteFsList.mockResolvedValue({ ok: false, code: 'not-logged-in' });
    await expect(createFilesApi(REMOTE).readDir('/')).rejects.toThrow('not-logged-in');
  });

  it('readTextFile liefert die Server-mtime als Locking-Basis mit', async () => {
    const res = await createFilesApi(REMOTE).readTextFile('/docs/a.md');
    expect(api.remoteFsRead).toHaveBeenCalledWith('srv1', 'proj1', 'docs/a.md');
    expect(res).toEqual({ ok: true, content: 'remote', mtime: 100 });
  });

  it('readTextFile reicht binary/too-large durch und dampft Unbekanntes auf server ein', async () => {
    api.remoteFsRead
      .mockResolvedValueOnce({ ok: false, code: 'binary' })
      .mockResolvedValueOnce({ ok: false, code: 'invalid-path' });
    const files = createFilesApi(REMOTE);
    expect(await files.readTextFile('/x')).toEqual({ ok: false, code: 'binary' });
    expect(await files.readTextFile('/x')).toEqual({ ok: false, code: 'server' });
  });

  it('writeTextFile schickt baseMtime mit und reicht den 409-Konflikt strukturiert durch', async () => {
    api.remoteFsWrite.mockResolvedValue({ ok: false, code: 'conflict', serverMtime: 999 });
    const files = createFilesApi(REMOTE);
    const res = await files.writeTextFile('/docs/a.md', 'neu', 100);
    expect(api.remoteFsWrite).toHaveBeenCalledWith('srv1', 'proj1', 'docs/a.md', 'neu', 100);
    expect(res).toEqual({ ok: false, code: 'conflict', serverMtime: 999 });
  });

  it('createFile prüft auf Existenz und legt sonst eine leere Datei an', async () => {
    api.remoteFsRead.mockResolvedValue({ ok: false, code: 'not-found' });
    const files = createFilesApi(REMOTE);
    const res = await files.createFile('/', 'neu.txt');
    expect(api.remoteFsWrite).toHaveBeenCalledWith('srv1', 'proj1', 'neu.txt', '');
    expect(res).toEqual({ ok: true, path: '/neu.txt' });
  });

  it('createFile meldet exists, wenn die Datei schon da ist (auch binär/zu groß)', async () => {
    api.remoteFsRead.mockResolvedValueOnce({ ok: true, content: '', mtime: 1, size: 0 });
    const files = createFilesApi(REMOTE);
    expect(await files.createFile('/', 'da.txt')).toEqual({ ok: false, code: 'exists' });

    api.remoteFsRead.mockResolvedValueOnce({ ok: false, code: 'binary' });
    expect(await files.createFile('/', 'bild.png')).toEqual({ ok: false, code: 'exists' });
    expect(api.remoteFsWrite).not.toHaveBeenCalled();
  });

  it('createFile lehnt ungültige Namen lokal ab (wie fs-browser)', async () => {
    const files = createFilesApi(REMOTE);
    expect(await files.createFile('/', 'a/b.txt')).toEqual({ ok: false, code: 'invalid-name' });
    expect(await files.createFile('/', '..')).toEqual({ ok: false, code: 'invalid-name' });
    expect(api.remoteFsRead).not.toHaveBeenCalled();
  });

  it('deletePath ruft remoteFs:delete auf und wirft bei Fehlern', async () => {
    const files = createFilesApi(REMOTE);
    await files.deletePath('/docs/a.md');
    expect(api.remoteFsDelete).toHaveBeenCalledWith('srv1', 'proj1', 'docs/a.md');

    api.remoteFsDelete.mockResolvedValue({ ok: false, code: 'forbidden', message: 'Viewer haben nur Lesezugriff' });
    await expect(files.deletePath('/docs/a.md')).rejects.toThrow('Viewer haben nur Lesezugriff');
  });

  it('terminalPath mappt auf die Container-Sicht /workspace', () => {
    const files = createFilesApi(REMOTE);
    expect(files.terminalPath('/')).toBe('/workspace');
    expect(files.terminalPath('/src/app.ts')).toBe('/workspace/src/app.ts');
  });
});
