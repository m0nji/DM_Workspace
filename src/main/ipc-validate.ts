import type {
  AgentDonePayload, PtyInputRequest, PtyResizeRequest, PtySpawnRequest, ServerConfig,
  SpawnTarget, SpawnTargetScope
} from '../shared/types';
import type { Task, TaskBoard, TaskColumn } from '../shared/tasks-markdown';

// Laufzeitprüfung für IPC-Payloads.
//
// Die Parametertypen an den ipcMain-Handlern sind reine Behauptungen: über IPC
// kommt strukturiertes JSON an, das TypeScript nicht erzwingen kann. Ein
// abweichender Payload schlägt deshalb erst tief im Handler fehl — und das ist
// bei `ipcMain.on` teuer: anders als `.handle` fängt ein `on`-Listener den Throw
// NICHT in ein rejected Promise, er wird zur uncaughtException im Main-Prozess
// und riss vor dem Crash-Guard jede laufende Shell mit.
//
// Konkretes Beispiel: node-pty wirft in resize() bei nicht-positiven Werten
// ("resizing must be done using positive cols and rows"). Erreichbar ist das
// heute nicht — FitAddon klemmt auf cols >= 2 —, aber die Absicherung gehört an
// die Grenze, nicht an den Aufrufer.
//
// Jeder parse* gibt bei ungültigem Input null zurück; der Handler verwirft den
// Payload dann, statt zu werfen.

// Obergrenze für Terminaldimensionen. node-pty verlangt nur > 0; die Grenze
// verhindert, dass ein absurder Wert Puffer in Zeilen- mal Spaltengröße anlegt.
export const MAX_DIMENSION = 10_000;

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/**
 * Eine Terminaldimension: endliche, ganze Zahl in [1, MAX_DIMENSION].
 * Gibt null zurück (statt zu klemmen), damit ein offensichtlich kaputter Payload
 * verworfen wird, statt still auf einen Ersatzwert zu laufen.
 */
export function asDimension(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isInteger(v)) return null;
  return v >= 1 && v <= MAX_DIMENSION ? v : null;
}

export function parsePtyInput(raw: unknown): PtyInputRequest | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.paneId) || typeof raw.data !== 'string') return null;
  return { paneId: raw.paneId, data: raw.data };
}

export function parsePtyResize(raw: unknown): PtyResizeRequest | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.paneId)) return null;
  const cols = asDimension(raw.cols);
  const rows = asDimension(raw.rows);
  if (cols === null || rows === null) return null;
  return { paneId: raw.paneId, cols, rows };
}

// Scope eines Remote-Targets: geteilte Projekt-Runtime oder persönliche
// User-Runtime (Remote-Workspaces-Plan, Abschnitt 4.2).
function parseSpawnTargetScope(raw: unknown): SpawnTargetScope | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'user') return { kind: 'user' };
  if (raw.kind === 'project' && isNonEmptyString(raw.projectId)) {
    return { kind: 'project', projectId: raw.projectId };
  }
  return null;
}

// Streng: ein vorhandenes, aber kaputtes target verwirft den ganzen Payload —
// still auf lokal zurückzufallen würde einen Renderer-Bug als lokale Shell
// tarnen, wo eine Remote-Shell gemeint war. Nur die bekannten Felder werden
// übernommen (wie überall in dieser Datei).
function parseSpawnTarget(raw: unknown): SpawnTarget | null {
  if (!isRecord(raw)) return null;
  if (raw.kind === 'local') return { kind: 'local' };
  if (raw.kind !== 'remote') return null;
  if (!isNonEmptyString(raw.serverId) || !isNonEmptyString(raw.remotePaneId)) return null;
  const scope = parseSpawnTargetScope(raw.scope);
  if (scope === null) return null;
  return { kind: 'remote', serverId: raw.serverId, scope, remotePaneId: raw.remotePaneId };
}

export function parsePtySpawn(raw: unknown): PtySpawnRequest | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.paneId) || typeof raw.cwd !== 'string') return null;
  const cols = asDimension(raw.cols);
  const rows = asDimension(raw.rows);
  if (cols === null || rows === null) return null;
  const req: PtySpawnRequest = { paneId: raw.paneId, cwd: raw.cwd, cols, rows };
  // target ist optional; fehlend heißt lokal (heutiger Payload bleibt gültig).
  if (raw.target !== undefined) {
    const target = parseSpawnTarget(raw.target);
    if (target === null) return null;
    req.target = target;
  }
  return req;
}

export function parseScrollbackSave(raw: unknown): { paneId: string; data: string } | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.paneId) || typeof raw.data !== 'string') return null;
  return { paneId: raw.paneId, data: raw.data };
}

export function parseAgentDone(raw: unknown): AgentDonePayload | null {
  if (!isRecord(raw)) return null;
  if (
    !isNonEmptyString(raw.workspaceId) ||
    typeof raw.workspaceName !== 'string' ||
    typeof raw.paneTitle !== 'string'
  ) return null;
  return { workspaceId: raw.workspaceId, workspaceName: raw.workspaceName, paneTitle: raw.paneTitle };
}

// ---- Remote-Workspaces (Plan 4.4) ------------------------------------------

// Nur http(s)-URLs ohne eingebettete Credentials; ein Trailing-Slash wird
// normalisiert, damit `${baseUrl}/api/...` nie doppelte Slashes produziert.
export function parseServerConfig(raw: unknown): ServerConfig | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name) || !isNonEmptyString(raw.baseUrl)) return null;
  let url: URL;
  try {
    url = new URL(raw.baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return { id: raw.id, name: raw.name, baseUrl: raw.baseUrl.replace(/\/+$/, '') };
}

export function parseServerRef(raw: unknown): { serverId: string } | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.serverId)) return null;
  return { serverId: raw.serverId };
}

// Verweis auf ein Server-Projekt — ausschließlich für die projektgebundenen
// remoteFs:*-Kanäle (die Datei-API des Servers kennt keine User-Runtimes).
export function parseRemoteRef(raw: unknown): { serverId: string; projectId: string } | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.serverId) || !isNonEmptyString(raw.projectId)) return null;
  return { serverId: raw.serverId, projectId: raw.projectId };
}

// Verweis auf eine (Server, Scope)-Verbindung: scopeKey ist die Projekt-UUID
// oder der reservierte Bezeichner 'user' (shared/remote-pane-key.ts) — die
// Kanäle remote:connectWorkspace/panes/disconnect/driver* decken beide Arten ab.
export function parseRemoteScopeRef(raw: unknown): { serverId: string; scopeKey: string } | null {
  if (!isRecord(raw) || !isNonEmptyString(raw.serverId) || !isNonEmptyString(raw.scopeKey)) return null;
  return { serverId: raw.serverId, scopeKey: raw.scopeKey };
}

export function parseRemotePaneRef(raw: unknown): { serverId: string; scopeKey: string; paneId: string } | null {
  const base = parseRemoteScopeRef(raw);
  if (!base || !isRecord(raw) || !isNonEmptyString(raw.paneId)) return null;
  return { ...base, paneId: raw.paneId };
}

export function parseRemoteDriverDecision(
  raw: unknown
): { serverId: string; scopeKey: string; paneId: string; clientId: string } | null {
  const base = parseRemotePaneRef(raw);
  if (!base || !isRecord(raw) || !isNonEmptyString(raw.clientId)) return null;
  return { ...base, clientId: raw.clientId };
}

// ---- Remote-Dateizugriff (B3) ----------------------------------------------
//
// Pfade der remoteFs:*-Kanäle sind RELATIVE Projektpfade mit '/'-Trennern
// ('' = Projektroot). Der Server normalisiert und begrenzt selbst noch einmal
// (resolveProjectPath); die Prüfung hier hält offensichtlich feindliche oder
// kaputte Pfade trotzdem schon an der IPC-Grenze auf: '..'-Segmente,
// Windows-Backslashes (der Renderer baut Pfade immer mit '/') und NUL-Bytes.

export function isSafeRemoteFsPath(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (v.includes('\\') || v.includes('\0')) return false;
  return !v.split('/').some((segment) => segment === '..');
}

export function parseRemoteFsList(raw: unknown): { serverId: string; projectId: string; path: string } | null {
  const base = parseRemoteRef(raw);
  if (!base || !isRecord(raw) || !isSafeRemoteFsPath(raw.path)) return null;
  return { ...base, path: raw.path };
}

// Für read/mkdir/delete: wie list, aber der Projektroot ('') ist kein gültiges
// Ziel (lesen/löschen/anlegen des Roots lehnt auch der Server ab).
export function parseRemoteFsFile(raw: unknown): { serverId: string; projectId: string; path: string } | null {
  const base = parseRemoteFsList(raw);
  return base && base.path !== '' ? base : null;
}

export function parseRemoteFsWrite(
  raw: unknown
): { serverId: string; projectId: string; path: string; content: string; baseMtime?: number } | null {
  const base = parseRemoteFsFile(raw);
  if (!base || !isRecord(raw) || typeof raw.content !== 'string') return null;
  const req: { serverId: string; projectId: string; path: string; content: string; baseMtime?: number } =
    { ...base, content: raw.content };
  if (raw.baseMtime !== undefined) {
    if (typeof raw.baseMtime !== 'number' || !Number.isFinite(raw.baseMtime) || raw.baseMtime < 0) return null;
    req.baseMtime = raw.baseMtime;
  }
  return req;
}

export function parseRemoteFsRename(
  raw: unknown
): { serverId: string; projectId: string; from: string; to: string } | null {
  const base = parseRemoteRef(raw);
  if (!base || !isRecord(raw)) return null;
  if (!isSafeRemoteFsPath(raw.from) || !isSafeRemoteFsPath(raw.to) || raw.from === '' || raw.to === '') return null;
  return { ...base, from: raw.from, to: raw.to };
}

// password bewusst nur als string geprüft (auch leer wäre strukturell gültig,
// der Server lehnt es fachlich ab) — und wie bei pty:input gilt: den Payload
// dieses Kanals NIEMALS loggen.
export function parseLoginLocal(raw: unknown): { serverId: string; username: string; password: string } | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.serverId) || !isNonEmptyString(raw.username) || typeof raw.password !== 'string') return null;
  return { serverId: raw.serverId, username: raw.username, password: raw.password };
}

// Ein Task wird strukturell normalisiert statt nur geprüft: das Board geht direkt
// in serializeTasks und von dort in die TASKS.md des Nutzers. Ein Fremdfeld dürfte
// dort nicht landen, und ein fehlendes Pflichtfeld würde beim Serialisieren zu
// "undefined" im Markdown.
function parseTask(raw: unknown): Task | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.id) || typeof raw.title !== 'string' || typeof raw.done !== 'boolean') return null;
  const out: Task = { id: raw.id, title: raw.title, done: raw.done };
  if (typeof raw.description === 'string') out.description = raw.description;
  if (typeof raw.command === 'string') out.command = raw.command;
  return out;
}

function parseTaskColumn(raw: unknown): TaskColumn | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.name !== 'string' || !Array.isArray(raw.tasks)) return null;
  const tasks: Task[] = [];
  for (const t of raw.tasks) {
    const task = parseTask(t);
    if (!task) return null; // ein kaputter Task verwirft das Board, statt ihn stumm zu schlucken
    tasks.push(task);
  }
  return { name: raw.name, tasks };
}

export function parseTasksSave(raw: unknown): { dir: string; board: TaskBoard } | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.dir) || !isRecord(raw.board)) return null;
  if (!Array.isArray(raw.board.columns)) return null;
  const columns: TaskColumn[] = [];
  for (const c of raw.board.columns) {
    const col = parseTaskColumn(c);
    if (!col) return null;
    columns.push(col);
  }
  return { dir: raw.dir, board: { columns } };
}
