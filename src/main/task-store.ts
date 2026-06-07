import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'fs';
import { join, dirname, parse as parsePath } from 'path';
import { parseTasks, serializeTasks, type TaskBoard } from '../shared/tasks-markdown';

const DIR = '.dmworkspace';
const GITIGNORE_ENTRY = '.dmworkspace/';

export function tasksFilePath(workingDir: string): string {
  return join(workingDir, DIR, 'TASKS.md');
}

// Read+parse the board for a working dir. Missing/unreadable file => default board.
export function loadTasks(workingDir: string): TaskBoard {
  try {
    return parseTasks(readFileSync(tasksFilePath(workingDir), 'utf8'));
  } catch {
    return parseTasks('');
  }
}

// Serialize+write the board. Creates .dmworkspace/ on demand and ensures the
// gitignore entry. Returns the exact bytes written (used by the IPC echo-guard).
export function saveTasks(workingDir: string, board: TaskBoard): string {
  const file = tasksFilePath(workingDir);
  mkdirSync(dirname(file), { recursive: true });
  const content = serializeTasks(board);
  writeFileSync(file, content, 'utf8');
  ensureGitignore(workingDir);
  return content;
}

// Find the nearest ancestor directory (inclusive) that contains a .git entry.
function findGitRoot(startDir: string): string | null {
  let dir = startDir;
  const root = parsePath(dir).root;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

// Idempotently add `.dmworkspace/` to the git root's .gitignore so tasks never
// land in version control. No-op when the dir is not inside a git repo.
export function ensureGitignore(workingDir: string): void {
  const gitRoot = findGitRoot(workingDir);
  if (!gitRoot) return;
  const gitignore = join(gitRoot, '.gitignore');
  let existing = '';
  try { existing = readFileSync(gitignore, 'utf8'); } catch { /* none yet */ }
  const has = existing.split(/\r?\n/).some((l) => l.trim() === GITIGNORE_ENTRY || l.trim() === '.dmworkspace');
  if (has) return;
  const prefix = existing.length && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(gitignore, `${prefix}${GITIGNORE_ENTRY}\n`, 'utf8');
}
