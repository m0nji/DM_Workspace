import { describe, expect, it, vi } from 'vitest';
import { RemoteTasks } from '../src/main/remote/remote-tasks';

// REST-Client der Remote-Task-API (geplante Agenten-Tasks): fetch ist
// gemockt; geprüft werden URL-/Pfad-Mapping, Cookie-Header, das
// `access`-Feld aus GET .../tasks (siehe shared/types.ts) und die Abbildung
// der HTTP-Statuscodes auf den strukturierten Fehlerkatalog.

const resolve = (): { baseUrl: string; cookie: string | null } =>
  ({ baseUrl: 'https://dmw.example', cookie: 'dmw_session=abc' });

function fetchOnce(status: number, body: unknown): typeof fetch {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' }
  }))) as unknown as typeof fetch;
}

describe('RemoteTasks', () => {
  it('ruft die Task-Liste unter dem Projekt ab, schickt das Session-Cookie mit und nimmt access vom Server', async () => {
    // GET /api/projects/:id/tasks liefert neben den Tasks auch die
    // effektiven Rechte des Aufrufers (access.canManage/canRun/canAssign) —
    // der Client übernimmt sie 1:1, statt die Rolle selbst nachzubilden.
    const fetchFn = fetchOnce(200, {
      tasks: [{ id: 't1', name: 'Deps' }],
      access: { canManage: true, canRun: true, canAssign: false }
    });
    const api = new RemoteTasks({ resolve, fetchFn });

    const res = await api.list('srv1', 'proj1');

    expect(res).toEqual({
      ok: true,
      tasks: [{ id: 't1', name: 'Deps' }],
      access: { canManage: true, canRun: true, canAssign: false }
    });
    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://dmw.example/api/projects/proj1/tasks');
    expect((init.headers as Record<string, string>).Cookie).toBe('dmw_session=abc');
  });

  it('meldet eine fehlende access-Angabe als Server-Fehler, statt Rechte zu raten', async () => {
    // Ohne access-Feld (z. B. ein älterer, noch nicht abgeglichener Server)
    // darf der Client keine Rechte annehmen — weder großzügig noch restriktiv
    // geraten, sondern laut scheitern.
    const fetchFn = fetchOnce(200, { tasks: [] });
    const api = new RemoteTasks({ resolve, fetchFn });
    expect(await api.list('srv1', 'proj1')).toMatchObject({ ok: false, code: 'server' });
  });

  it('meldet ein fehlendes canRun als Server-Fehler, statt es aus der Rolle zu erraten', async () => {
    // Ein Server, der access.canRun (noch) nicht mitliefert, ist genauso ein
    // Fall für den Fehlerpfad wie ein fehlendes access-Objekt insgesamt —
    // sonst würde der Aufrufer canRun clientseitig nachbauen müssen.
    const fetchFn = fetchOnce(200, {
      tasks: [],
      access: { canManage: true, canAssign: false }
    });
    const api = new RemoteTasks({ resolve, fetchFn });
    expect(await api.list('srv1', 'proj1')).toMatchObject({ ok: false, code: 'server' });
  });

  it('bildet Statuscodes auf Fehlercodes ab, statt zu werfen', async () => {
    const cases: Array<[number, string]> = [
      [401, 'not-logged-in'], [403, 'forbidden'], [404, 'not-found'],
      [409, 'conflict'], [400, 'invalid'], [500, 'server'],
    ];
    for (const [status, code] of cases) {
      const api = new RemoteTasks({ resolve, fetchFn: fetchOnce(status, { error: 'nope' }) });
      expect(await api.run('srv1', 'proj1', 't1')).toEqual({ ok: false, code, message: 'nope' });
    }
  });

  it('meldet einen unbekannten Server, ohne ins Netz zu gehen', async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const api = new RemoteTasks({ resolve: () => null, fetchFn });
    expect(await api.list('weg', 'proj1')).toEqual({ ok: false, code: 'not-logged-in' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  // `message` trägt ausschließlich das, was der Server geschickt hat (siehe
  // RemoteTaskError): die Oberfläche zeigt das Feld wörtlich an und übersetzt
  // nur, wenn es fehlt. Eine rohe fetch-Ausnahme stünde sonst technisch und
  // unübersetzt vor dem Nutzer ("fetch failed" statt "Server nicht
  // erreichbar"). Deshalb toEqual statt toMatchObject: geprüft wird gerade,
  // dass KEIN message-Feld dranhängt.
  it('meldet Netzfehler als network, ohne die rohe Ausnahme als Meldung mitzugeben', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
    const api = new RemoteTasks({ resolve, fetchFn });
    expect(await api.list('srv1', 'proj1')).toEqual({ ok: false, code: 'network' });
  });

  // Gegenstück für die unerwartete Antwortform (z. B. ein Reverse-Proxy
  // liefert HTML): dort stand vorher ein fest deutscher Satz im message-Feld,
  // den auch eine englische Oberfläche wörtlich angezeigt hätte.
  it('meldet eine unerwartete Antwortform als server, ohne eigene Meldung', async () => {
    const api = new RemoteTasks({ resolve, fetchFn: fetchOnce(200, { unerwartet: true }) });
    expect(await api.list('srv1', 'proj1')).toEqual({ ok: false, code: 'server' });

    const runsApi = new RemoteTasks({ resolve, fetchFn: fetchOnce(200, {}) });
    expect(await runsApi.listRuns('srv1', 'proj1', 't1')).toEqual({ ok: false, code: 'server' });
  });

  // Die Zusage gilt nur für lokal erfundene Texte — was der Server selbst
  // schickt, bleibt erhalten (auch bei 5xx).
  it('behält die Servermeldung, wenn der Server eine schickt', async () => {
    const api = new RemoteTasks({ resolve, fetchFn: fetchOnce(500, { error: 'Datenbank nicht erreichbar' }) });
    expect(await api.list('srv1', 'proj1')).toEqual({ ok: false, code: 'server', message: 'Datenbank nicht erreichbar' });
  });

  it('409 beim Sofortstart bleibt als conflict erkennbar (im Projekt läuft schon ein Lauf)', async () => {
    const api = new RemoteTasks({ resolve, fetchFn: fetchOnce(409, { error: 'Im Projekt läuft bereits ein Lauf' }) });
    const res = await api.run('srv1', 'proj1', 't1');
    expect(res).toMatchObject({ ok: false, code: 'conflict' });
  });

  it('bildet Task-Ändern (PATCH) und -Löschen (DELETE) auf die richtigen Pfade/Methoden ab', async () => {
    const updateFetch = fetchOnce(200, { task: { id: 't1', name: 'Neu' } });
    const updateApi = new RemoteTasks({ resolve, fetchFn: updateFetch });
    const updateRes = await updateApi.update('srv1', 'proj1', 't1', { name: 'Neu' });
    expect(updateRes).toEqual({ ok: true, task: { id: 't1', name: 'Neu' } });
    const [updateUrl, updateInit] = (updateFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(updateUrl).toBe('https://dmw.example/api/projects/proj1/tasks/t1');
    expect(updateInit.method).toBe('PATCH');

    const removeFetch = fetchOnce(200, { ok: true });
    const removeApi = new RemoteTasks({ resolve, fetchFn: removeFetch });
    expect(await removeApi.remove('srv1', 'proj1', 't1')).toEqual({ ok: true });
    const [removeUrl, removeInit] = (removeFetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(removeUrl).toBe('https://dmw.example/api/projects/proj1/tasks/t1');
    expect(removeInit.method).toBe('DELETE');
  });

  it('holt einen einzelnen Lauf samt Protokoll unter /runs/:runId (nicht unter /tasks/:taskId/runs/)', async () => {
    const fetchFn = fetchOnce(200, {
      run: { id: 'r1', taskId: 't1', status: 'success', trigger: 'manual', startedBy: 'u1',
        startedAt: '2026-08-09T10:00:00.000Z', finishedAt: '2026-08-09T10:01:00.000Z', exitCode: 0, log: 'npm audit…' }
    });
    const api = new RemoteTasks({ resolve, fetchFn });
    const res = await api.getRun('srv1', 'proj1', 'r1');
    expect(res).toMatchObject({ ok: true, run: { id: 'r1', log: 'npm audit…' } });
    const [url] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://dmw.example/api/projects/proj1/runs/r1');
  });

  it('bricht einen Lauf über /runs/:runId/cancel ab', async () => {
    const fetchFn = fetchOnce(200, { ok: true });
    const api = new RemoteTasks({ resolve, fetchFn });
    expect(await api.cancel('srv1', 'proj1', 'r1')).toEqual({ ok: true });
    const [url, init] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://dmw.example/api/projects/proj1/runs/r1/cancel');
    expect(init.method).toBe('POST');
  });

  it('holt die Projektmitglieder und lässt nur vollständige Einträge durch', async () => {
    // Der Owner-Picker ersetzt ein UUID-Textfeld: Ein Eintrag ohne userId oder
    // displayName wäre eine Auswahl ohne Beschriftung bzw. ohne Wert — also
    // aussortieren statt halb anzeigen.
    const fetchFn = fetchOnce(200, {
      members: [
        { userId: 'u1', username: 'm0nji', displayName: 'Thomas', role: 'owner' },
        { userId: 'u2', username: 'ada', displayName: 'Ada', role: 'viewer' },
        { userId: 'u3', username: 'kaputt' },
        'unfug'
      ],
      ownRole: 'owner'
    });
    const api = new RemoteTasks({ resolve, fetchFn });

    const res = await api.members('srv1', 'proj1');

    expect(res).toEqual({
      ok: true,
      members: [
        { userId: 'u1', username: 'm0nji', displayName: 'Thomas', role: 'owner' },
        { userId: 'u2', username: 'ada', displayName: 'Ada', role: 'viewer' }
      ]
    });
    const [url] = (fetchFn as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('https://dmw.example/api/projects/proj1/members');
  });

  it('meldet eine fehlende members-Liste als Server-Fehler', async () => {
    const api = new RemoteTasks({ resolve, fetchFn: fetchOnce(200, {}) });
    expect(await api.members('srv1', 'proj1')).toMatchObject({ ok: false, code: 'server' });
  });

  it('reicht 403 als forbidden durch, wenn man kein Mitglied des Projekts ist', async () => {
    const api = new RemoteTasks({ resolve, fetchFn: fetchOnce(403, { error: 'Kein Mitglied dieses Projekts' }) });
    expect(await api.members('srv1', 'proj1'))
      .toEqual({ ok: false, code: 'forbidden', message: 'Kein Mitglied dieses Projekts' });
  });
});
