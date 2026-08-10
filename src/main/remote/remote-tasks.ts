// Remote-Task-Zugriff (geplante Agenten-Tasks, Arbeitspaket B, Aufgabe 1):
// dünner, authentifizierter REST-Client gegen die Task-API des Workspace-
// Servers (tasks/routes.ts in dm_workspace_web). Aufbau wörtlich analog zu
// remote-files.ts: Base-URL und Session-Cookie liefert der RemoteManager
// (Serverliste + AuthManager) über die injizierte resolve-Funktion — Tokens
// verlassen den Main-Prozess nie.
//
// Fehler werden auf strukturierte Ergebnisse abgebildet statt zu werfen
// (RemoteTaskError in shared/types.ts): die IPC-Handler reichen sie
// unverändert an den Renderer durch, der gezielt reagiert (401 -> „nicht
// angemeldet", 409 beim Sofortstart -> „läuft bereits ein Lauf im Projekt").
//
// `message` wird ausschließlich mit dem gefüllt, was der Server tatsächlich
// geschickt hat (das `error`-Feld seiner Antwort). Hier NICHTS erfinden: die
// Oberfläche zeigt das Feld dem Nutzer wörtlich an und übersetzt nur, wenn es
// fehlt. Eine rohe fetch-Ausnahme („fetch failed") oder ein hier
// hingeschriebener deutscher Satz landeten damit unübersetzt und technisch
// vor den Augen des Nutzers. Diagnose gehört stattdessen ins Log des
// Main-Prozesses (console.warn unten).

import type {
  RemoteMembersResult, RemoteProjectMember, RemoteRunResult, RemoteTask, RemoteTaskAccess,
  RemoteTaskError, RemoteTaskErrorCode, RemoteTaskListResult, RemoteTaskOkResult, RemoteTaskResult,
  RemoteTaskRun, RemoteTaskRunsResult
} from '../../shared/types';

export interface RemoteTasksDeps {
  /** Base-URL + Session-Cookie eines Servers; null bei unbekanntem Server. */
  resolve: (serverId: string) => { baseUrl: string; cookie: string | null } | null;
  fetchFn?: typeof fetch;
}

function codeForStatus(status: number): RemoteTaskErrorCode {
  switch (status) {
    case 400: return 'invalid';
    case 401: return 'not-logged-in';
    case 403: return 'forbidden';
    case 404: return 'not-found';
    case 409: return 'conflict';
    default: return 'server';
  }
}

type RequestResult =
  | { ok: true; body: Record<string, unknown> }
  | RemoteTaskError;

export class RemoteTasks {
  constructor(private readonly deps: RemoteTasksDeps) {}

  private get fetchFn(): typeof fetch {
    return this.deps.fetchFn ?? fetch;
  }

  // Gemeinsamer Unterbau aller Operationen: Server auflösen, Cookie anhängen,
  // Statuscode auf den Fehlerkatalog abbilden. Ein unbekannter Server und ein
  // (noch) fehlendes Session-Cookie sind aus Sicht des Aufrufers dasselbe —
  // „nicht angemeldet" — und gehen beide ohne Netzzugriff sofort zurück.
  private async request(
    serverId: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', apiPath: string, body?: unknown
  ): Promise<RequestResult> {
    const resolved = this.deps.resolve(serverId);
    if (!resolved || !resolved.cookie) return { ok: false, code: 'not-logged-in' };
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
      // Die Ausnahme ist für die Fehlersuche wertvoll, aber kein Text für den
      // Nutzer — sie kommt aus fetch, nicht vom Server. Deshalb ins Log statt
      // in `message` (der Renderer zeigt dafür „Server nicht erreichbar").
      console.warn(`[remote] tasks ${method} ${apiPath} failed:`, err);
      return { ok: false, code: 'network' };
    }
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error: RemoteTaskError = { ok: false, code: codeForStatus(res.status) };
      if (typeof parsed.error === 'string' && parsed.error) error.message = parsed.error;
      return error;
    }
    return { ok: true, body: parsed };
  }

  // tasks/routes.ts: /api/projects/:projectId/tasks[...]
  private tasksUrl(projectId: string, suffix = ''): string {
    return `/api/projects/${encodeURIComponent(projectId)}/tasks${suffix}`;
  }

  // Läufe hängen NICHT unter /tasks/:taskId/, sondern eigenständig unter
  // /api/projects/:projectId/runs/:runId — ein Lauf ist über seine eigene ID
  // adressierbar, ohne dass der Aufrufer den zugehörigen Task kennen muss
  // (siehe GET/POST .../runs/:runId[/cancel] in tasks/routes.ts).
  private runUrl(projectId: string, runId: string, suffix = ''): string {
    return `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}${suffix}`;
  }

  private toTaskResult(res: RequestResult): RemoteTaskResult {
    if (!res.ok) return res;
    const task = res.body.task;
    if (typeof task !== 'object' || task === null) {
      return { ok: false, code: 'server' };
    }
    return { ok: true, task: task as RemoteTask };
  }

  async list(serverId: string, projectId: string): Promise<RemoteTaskListResult> {
    const res = await this.request(serverId, 'GET', this.tasksUrl(projectId));
    if (!res.ok) return res;
    const access = res.body.access as Record<string, unknown> | undefined;
    if (
      !Array.isArray(res.body.tasks) ||
      typeof access !== 'object' || access === null ||
      typeof access.canManage !== 'boolean' || typeof access.canRun !== 'boolean' || typeof access.canAssign !== 'boolean'
    ) {
      return { ok: false, code: 'server' };
    }
    return { ok: true, tasks: res.body.tasks as RemoteTask[], access: access as unknown as RemoteTaskAccess };
  }

  async create(serverId: string, projectId: string, body: object): Promise<RemoteTaskResult> {
    const res = await this.request(serverId, 'POST', this.tasksUrl(projectId), body);
    return this.toTaskResult(res);
  }

  // Der Server nimmt Änderungen als PATCH entgegen (nur gesetzte Felder
  // werden übernommen, siehe parseTaskBody in tasks/routes.ts) — keine
  // Vollersetzung wie remote-files.ts' write() per PUT.
  async update(serverId: string, projectId: string, taskId: string, body: object): Promise<RemoteTaskResult> {
    const res = await this.request(serverId, 'PATCH', this.tasksUrl(projectId, `/${encodeURIComponent(taskId)}`), body);
    return this.toTaskResult(res);
  }

  async remove(serverId: string, projectId: string, taskId: string): Promise<RemoteTaskOkResult> {
    const res = await this.request(serverId, 'DELETE', this.tasksUrl(projectId, `/${encodeURIComponent(taskId)}`));
    return res.ok ? { ok: true } : res;
  }

  async run(serverId: string, projectId: string, taskId: string): Promise<RemoteTaskOkResult> {
    const res = await this.request(serverId, 'POST', this.tasksUrl(projectId, `/${encodeURIComponent(taskId)}/run`));
    return res.ok ? { ok: true } : res;
  }

  async cancel(serverId: string, projectId: string, runId: string): Promise<RemoteTaskOkResult> {
    const res = await this.request(serverId, 'POST', this.runUrl(projectId, runId, '/cancel'));
    return res.ok ? { ok: true } : res;
  }

  async listRuns(serverId: string, projectId: string, taskId: string): Promise<RemoteTaskRunsResult> {
    const res = await this.request(serverId, 'GET', this.tasksUrl(projectId, `/${encodeURIComponent(taskId)}/runs`));
    if (!res.ok) return res;
    if (!Array.isArray(res.body.runs)) {
      return { ok: false, code: 'server' };
    }
    return { ok: true, runs: res.body.runs as RemoteTaskRun[] };
  }

  async getRun(serverId: string, projectId: string, runId: string): Promise<RemoteRunResult> {
    const res = await this.request(serverId, 'GET', this.runUrl(projectId, runId));
    if (!res.ok) return res;
    const run = res.body.run as Record<string, unknown> | undefined;
    if (typeof run !== 'object' || run === null || typeof run.log !== 'string') {
      return { ok: false, code: 'server' };
    }
    return { ok: true, run: run as unknown as RemoteTaskRun & { log: string } };
  }

  /**
   * Projektmitglieder für die Zuweisung eines Tasks. Liegt hier statt beim
   * RemoteManager, weil die Auswahl im Task-Formular sitzt und denselben
   * Fehlerkatalog braucht wie die übrigen Task-Aufrufe — der Renderer
   * übersetzt ihn mit describeTaskError bereits.
   *
   * Unvollständige Einträge werden aussortiert statt halb angezeigt: Ein
   * Eintrag ohne userId wäre eine Auswahl ohne Wert, einer ohne displayName
   * eine ohne Beschriftung.
   */
  async members(serverId: string, projectId: string): Promise<RemoteMembersResult> {
    const res = await this.request(
      serverId, 'GET', `/api/projects/${encodeURIComponent(projectId)}/members`
    );
    if (!res.ok) return res;
    if (!Array.isArray(res.body.members)) return { ok: false, code: 'server' };
    const members = res.body.members.flatMap((raw): RemoteProjectMember[] => {
      if (typeof raw !== 'object' || raw === null) return [];
      const m = raw as Record<string, unknown>;
      if (typeof m.userId !== 'string' || !m.userId) return [];
      if (typeof m.displayName !== 'string' || !m.displayName) return [];
      const role = m.role === 'owner' || m.role === 'editor' ? m.role : 'viewer';
      return [{
        userId: m.userId,
        username: typeof m.username === 'string' ? m.username : '',
        displayName: m.displayName,
        role
      }];
    });
    return { ok: true, members };
  }
}
