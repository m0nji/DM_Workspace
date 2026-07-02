import { readFileSync, existsSync, appendFileSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { parseTasks, serializeTasks, type TaskBoard } from '../shared/tasks-markdown';
import { expandTilde } from './resolve-cwd';
import { writeFileAtomic } from './atomic-write';

const DIR = '.dmworkspace';
const GITIGNORE_ENTRY = '.dmworkspace/';

// A fresh workspace defaults its cwd to the literal '~' (and users may type a
// '~/...' path). The OS never expands the tilde, so expand it here — the single
// chokepoint where a workspace dir becomes a real filesystem path — before any
// fs call. mkdirSync('~/.dmworkspace') would otherwise crash the main process.
export function tasksFilePath(workingDir: string): string {
  return join(expandTilde(workingDir), DIR, 'TASKS.md');
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
  const content = serializeTasks(board);
  writeFileAtomic(file, content);
  ensureGitignore(workingDir);
  return content;
}

// Find the nearest ancestor directory (inclusive) that contains a .git entry.
// resolve() makes the walk safe for relative input, where dirname() would
// otherwise settle on '.' and never reach a filesystem root (infinite loop).
function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null; // reached the fs root
    dir = parent;
  }
}

// Idempotently add `.dmworkspace/` to the git root's .gitignore so tasks never
// land in version control. No-op when the dir is not inside a git repo.
export function ensureGitignore(workingDir: string): void {
  const gitRoot = findGitRoot(expandTilde(workingDir));
  if (!gitRoot) return;
  const gitignore = join(gitRoot, '.gitignore');
  let existing = '';
  try { existing = readFileSync(gitignore, 'utf8'); } catch { /* none yet */ }
  const has = existing.split(/\r?\n/).some((l) => l.trim() === GITIGNORE_ENTRY || l.trim() === '.dmworkspace');
  if (has) return;
  const prefix = existing.length && !existing.endsWith('\n') ? '\n' : '';
  appendFileSync(gitignore, `${prefix}${GITIGNORE_ENTRY}\n`, 'utf8');
}
