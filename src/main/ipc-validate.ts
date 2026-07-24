import type {
  AgentDonePayload, PtyInputRequest, PtyResizeRequest, PtySpawnRequest
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

export function parsePtySpawn(raw: unknown): PtySpawnRequest | null {
  if (!isRecord(raw)) return null;
  if (!isNonEmptyString(raw.paneId) || typeof raw.cwd !== 'string') return null;
  const cols = asDimension(raw.cols);
  const rows = asDimension(raw.rows);
  if (cols === null || rows === null) return null;
  return { paneId: raw.paneId, cwd: raw.cwd, cols, rows };
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
