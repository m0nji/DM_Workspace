# Task-Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein leichtgewichtiges Kanban-Board pro Arbeitsverzeichnis, gespeichert als `.dmworkspace/TASKS.md`, bidirektional dateigebunden, mit „▶ Run" eines Tasks in ein gewähltes Terminal-Pane.

**Architecture:** Reiner Markdown-Parser im `shared/`-Layer (vitest-testbar). Datei-IO + gitignore + Echo-Guard im `main/`-Layer nach dem Muster von `scrollback.ts`. File-Watcher in `ipc.ts` schickt Änderungen an den Renderer. Ein zustand-Slice hält Board + View-Umschalter; die Board-UI sendet Befehle über die bestehende `window.api.input`-IPC ins Pane und reaktiviert die Terminal-Ansicht. Terminals bleiben beim Umschalten via `display:none` gemountet (xterm-Instanzen überleben).

**Tech Stack:** Electron + electron-vite, React 18, zustand, TypeScript, node fs, vitest (unit, `tests/`), Playwright (e2e, `e2e/`).

**Referenz-Spec:** `docs/superpowers/specs/2026-06-07-task-board-design.md`

---

## File Structure

| Datei | Verantwortung | Neu/Ändern |
|-------|---------------|-----------|
| `src/shared/tasks-markdown.ts` | Typen `Task`/`TaskColumn`/`TaskBoard` + `parseTasks`/`serializeTasks` (pur) | Neu |
| `src/main/task-store.ts` | Pfad, `loadTasks`/`saveTasks`, `ensureGitignore` (pur, kein electron) | Neu |
| `src/main/ipc.ts` | IPC-Handler `tasks:load`/`tasks:save` + fs.watch + Echo-Guard | Ändern |
| `src/preload/index.ts` | `loadTasks`/`saveTasks`/`onTasksChanged` auf `window.api` | Ändern |
| `src/shared/types.ts` | Task-Typen re-exportieren + `RendererApi` erweitern + `Workspace.tasksEnabled` | Ändern |
| `src/renderer/store.ts` | Slice: `taskView`, `tasks`, `tasksDir`, Lade-/Edit-/Run-Aktionen + `setTasksEnabled` | Ändern |
| `src/renderer/components/WelcomeScreen.tsx` | Checkbox „Tasks aktivieren" beim Anlegen | Ändern |
| `src/renderer/components/WorkspaceNavigation.tsx` | Checkbox „Tasks aktivieren" im Edit-Panel | Ändern |
| `src/renderer/terminal-registry.ts` | Focus-Registry zusätzlich zur Clear-Registry | Ändern |
| `src/renderer/components/TerminalView.tsx` | Focus-Fn registrieren | Ändern |
| `src/renderer/components/TaskBoard.tsx` | Board-Ansicht (Spalten, Drag&Drop, Add/Edit) | Neu |
| `src/renderer/components/TaskCard.tsx` | Karte + Run-Button + Pane-Picker | Neu |
| `src/renderer/components/TitlebarActions.tsx` | Umschalter `Terminals ⇄ Tasks` | Ändern |
| `src/renderer/App.tsx` | TaskBoard rendern, WorkspaceView via `display:none` halten | Ändern |
| `src/renderer/styles.css` | Board-Styles | Ändern |
| `tests/tasks-markdown.test.ts` | Round-trip-Parser-Tests | Neu |
| `tests/task-store.test.ts` | gitignore-Idempotenz, Pfad, Load/Save | Neu |
| `e2e/task-board.spec.ts` | Anlegen → Datei; externe Änderung → Board; Run → Pane | Neu |

---

## Task 1: Markdown-Modell + Parser/Serializer (shared)

**Files:**
- Create: `src/shared/tasks-markdown.ts`
- Test: `tests/tasks-markdown.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tasks-markdown.test.ts
import { describe, it, expect } from 'vitest';
import { parseTasks, serializeTasks, DEFAULT_COLUMNS } from '../src/shared/tasks-markdown';

describe('parseTasks', () => {
  it('parses headings as columns and checkbox items as tasks', () => {
    const md = [
      '## Todo',
      '- [ ] Build fixen `npm run build`',
      '- [ ] Doku schreiben',
      '',
      '## Doing',
      '- [ ] Refactor pty-manager',
      '',
      '## Done',
      '- [x] Release 0.6.2'
    ].join('\n');
    const board = parseTasks(md);
    expect(board.columns.map((c) => c.name)).toEqual(['Todo', 'Doing', 'Done']);
    expect(board.columns[0].tasks[0]).toMatchObject({ title: 'Build fixen', command: 'npm run build', done: false });
    expect(board.columns[0].tasks[1]).toMatchObject({ title: 'Doku schreiben', command: undefined, done: false });
    expect(board.columns[2].tasks[0]).toMatchObject({ title: 'Release 0.6.2', done: true });
  });

  it('assigns unique ids to every task', () => {
    const board = parseTasks('## Todo\n- [ ] a\n- [ ] b\n## Done\n- [x] c');
    const ids = board.columns.flatMap((c) => c.tasks.map((t) => t.id));
    expect(new Set(ids).size).toBe(3);
  });

  it('returns the three default columns for empty input', () => {
    const board = parseTasks('');
    expect(board.columns.map((c) => c.name)).toEqual([...DEFAULT_COLUMNS]);
    expect(board.columns.every((c) => c.tasks.length === 0)).toBe(true);
  });

  it('keeps unknown extra headings tolerantly', () => {
    const board = parseTasks('## Backlog\n- [ ] later');
    expect(board.columns[0].name).toBe('Backlog');
  });

  it('round-trips through serialize without losing data', () => {
    const md = '## Todo\n- [ ] a `ls -la`\n- [x] b\n\n## Doing\n\n## Done\n- [x] c';
    const board = parseTasks(md);
    const reparsed = parseTasks(serializeTasks(board));
    const strip = (b: ReturnType<typeof parseTasks>) =>
      b.columns.map((c) => ({ name: c.name, tasks: c.tasks.map(({ title, command, done }) => ({ title, command, done })) }));
    expect(strip(reparsed)).toEqual(strip(board));
  });
});

describe('serializeTasks', () => {
  it('writes checkbox state and trailing backtick command', () => {
    const board = parseTasks('## Todo\n- [ ] a `cmd`\n## Done\n- [x] b');
    const out = serializeTasks(board);
    expect(out).toContain('## Todo');
    expect(out).toContain('- [ ] a `cmd`');
    expect(out).toContain('- [x] b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tasks-markdown.test.ts`
Expected: FAIL — `Cannot find module '../src/shared/tasks-markdown'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/shared/tasks-markdown.ts

export interface Task {
  id: string;        // ephemeral, assigned at parse time; not persisted to markdown
  title: string;
  command?: string;  // optional run command (trailing inline `code`); falls back to title when absent
  done: boolean;     // checkbox state
}

export interface TaskColumn {
  name: string;      // heading text
  tasks: Task[];
}

export interface TaskBoard {
  columns: TaskColumn[];
}

export const DEFAULT_COLUMNS = ['Todo', 'Doing', 'Done'] as const;

const HEADING = /^#{1,6}\s+(.*\S)\s*$/;
const ITEM = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/;
// Trailing inline-code command: "title `command`" → ['title', 'command']
const TRAILING_CMD = /^(.*?)\s*`([^`]+)`\s*$/;

// Parse a TASKS.md document into a board. Headings (##) become columns, checkbox
// list items become tasks. Tolerant: unknown headings are kept; non-matching lines
// are ignored. Empty input yields the three default columns.
export function parseTasks(md: string): TaskBoard {
  const columns: TaskColumn[] = [];
  let current: TaskColumn | null = null;
  let counter = 0;

  for (const rawLine of md.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const h = HEADING.exec(line);
    if (h) {
      current = { name: h[1], tasks: [] };
      columns.push(current);
      continue;
    }
    const it = ITEM.exec(line);
    if (it && current) {
      const done = it[1].toLowerCase() === 'x';
      let title = it[2].trim();
      let command: string | undefined;
      const m = TRAILING_CMD.exec(title);
      if (m) { title = m[1].trim(); command = m[2].trim(); }
      current.tasks.push({ id: `t${++counter}`, title, command, done });
    }
  }

  if (columns.length === 0) {
    return { columns: DEFAULT_COLUMNS.map((name) => ({ name, tasks: [] })) };
  }
  return { columns };
}

// Serialize a board back to markdown. Ids are not written; column order and
// in-column order are preserved verbatim.
export function serializeTasks(board: TaskBoard): string {
  const blocks = board.columns.map((col) => {
    const lines = [`## ${col.name}`];
    for (const t of col.tasks) {
      const box = t.done ? 'x' : ' ';
      const cmd = t.command ? ` \`${t.command}\`` : '';
      lines.push(`- [${box}] ${t.title}${cmd}`);
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tasks-markdown.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/shared/tasks-markdown.ts tests/tasks-markdown.test.ts
git commit -m "feat(tasks): markdown parser/serializer for task board"
```

---

## Task 2: TaskStore — Datei-IO + gitignore (main, electron-frei)

**Files:**
- Create: `src/main/task-store.ts`
- Test: `tests/task-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/task-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tasksFilePath, loadTasks, saveTasks, ensureGitignore } from '../src/main/task-store';
import { parseTasks } from '../src/shared/tasks-markdown';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dmtasks-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('tasksFilePath', () => {
  it('points at .dmworkspace/TASKS.md inside the working dir', () => {
    expect(tasksFilePath(dir)).toBe(join(dir, '.dmworkspace', 'TASKS.md'));
  });
});

describe('loadTasks', () => {
  it('returns default columns when the file is missing', () => {
    expect(loadTasks(dir).columns.map((c) => c.name)).toEqual(['Todo', 'Doing', 'Done']);
  });
  it('reads and parses an existing file', () => {
    mkdirSync(join(dir, '.dmworkspace'));
    writeFileSync(tasksFilePath(dir), '## Todo\n- [ ] x', 'utf8');
    expect(loadTasks(dir).columns[0].tasks[0].title).toBe('x');
  });
});

describe('saveTasks', () => {
  it('creates the directory and writes serialized markdown, returning the content', () => {
    const board = parseTasks('## Todo\n- [ ] hi `ls`');
    const written = saveTasks(dir, board);
    expect(existsSync(tasksFilePath(dir))).toBe(true);
    expect(readFileSync(tasksFilePath(dir), 'utf8')).toBe(written);
    expect(written).toContain('- [ ] hi `ls`');
  });
});

describe('ensureGitignore', () => {
  it('adds .dmworkspace/ to .gitignore at the nearest git root', () => {
    mkdirSync(join(dir, '.git'));
    ensureGitignore(dir);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.dmworkspace/');
  });
  it('is idempotent — no duplicate entry on repeated calls', () => {
    mkdirSync(join(dir, '.git'));
    ensureGitignore(dir);
    ensureGitignore(dir);
    const occurrences = readFileSync(join(dir, '.gitignore'), 'utf8').split('.dmworkspace/').length - 1;
    expect(occurrences).toBe(1);
  });
  it('walks up to an ancestor git root', () => {
    mkdirSync(join(dir, '.git'));
    const sub = join(dir, 'packages', 'app');
    mkdirSync(sub, { recursive: true });
    ensureGitignore(sub);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.dmworkspace/');
    expect(existsSync(join(sub, '.gitignore'))).toBe(false);
  });
  it('does nothing when there is no git repo', () => {
    ensureGitignore(dir);
    expect(existsSync(join(dir, '.gitignore'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/task-store.test.ts`
Expected: FAIL — `Cannot find module '../src/main/task-store'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/main/task-store.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/task-store.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/main/task-store.ts tests/task-store.test.ts
git commit -m "feat(tasks): TASKS.md store with idempotent gitignore"
```

---

## Task 3: IPC + Watcher + preload + types

**Files:**
- Modify: `src/shared/types.ts` (add task types + RendererApi methods)
- Modify: `src/main/ipc.ts:84-145` (register handlers + watcher inside `registerIpc`)
- Modify: `src/preload/index.ts:35-72` (expose api methods)

- [ ] **Step 1: Add task types and API surface to shared/types.ts**

Append the re-export near the top of `src/shared/types.ts` (after line 1, the existing `import`):

```ts
export type { Task, TaskColumn, TaskBoard } from './tasks-markdown';
```

Add these methods inside the `RendererApi` interface (after `readFile(...)` on line 135):

```ts
  // task board (TASKS.md per working dir)
  loadTasks(dir: string): Promise<import('./tasks-markdown').TaskBoard>;
  saveTasks(dir: string, board: import('./tasks-markdown').TaskBoard): void;
  onTasksChanged(cb: (dir: string, board: import('./tasks-markdown').TaskBoard) => void): () => void;
```

- [ ] **Step 2: Register IPC handlers + watcher in ipc.ts**

Add the import at the top of `src/main/ipc.ts` (after line 6, the ScrollbackStore import):

```ts
import { loadTasks, saveTasks, tasksFilePath } from './task-store';
import type { TaskBoard } from '../shared/types';
import { watch, type FSWatcher } from 'node:fs';
```

Inside `registerIpc` (after the `scrollback` handlers, before `clipboard:read` on line 119), add:

```ts
  // --- Task board ---------------------------------------------------------
  // Echo-guard: remember the exact content we last wrote per dir so the file
  // watcher ignores our own writes (no save→watch→reload ping-pong). Mirrors the
  // scrollback debounce philosophy. One watcher at a time (the board only ever
  // shows the active workspace's dir).
  let lastWritten = new Map<string, string>();
  let taskWatcher: FSWatcher | null = null;
  let watchedDir: string | null = null;
  let watchDebounce: ReturnType<typeof setTimeout> | null = null;

  const startTaskWatch = (dir: string): void => {
    if (watchedDir === dir && taskWatcher) return;
    taskWatcher?.close();
    taskWatcher = null;
    watchedDir = dir;
    const file = tasksFilePath(dir);
    try {
      // Watch the .dmworkspace dir (the file may not exist yet); filter on filename.
      taskWatcher = watch(require('path').dirname(file), (_evt, name) => {
        if (name && name.toString() !== 'TASKS.md') return;
        if (watchDebounce) clearTimeout(watchDebounce);
        watchDebounce = setTimeout(() => {
          let content = '';
          try { content = require('fs').readFileSync(file, 'utf8'); } catch { content = ''; }
          if (content === lastWritten.get(dir)) return; // our own write
          getWindow()?.webContents.send('tasks:changed', { dir, board: loadTasks(dir) });
        }, 150);
      });
    } catch { /* dir may not exist yet; re-armed on next tasks:load */ }
  };

  ipcMain.handle('tasks:load', (_e, dir: string): TaskBoard => {
    startTaskWatch(dir);
    return loadTasks(dir);
  });
  ipcMain.on('tasks:save', (_e, req: { dir: string; board: TaskBoard }) => {
    const content = saveTasks(req.dir, req.board);
    lastWritten.set(req.dir, content);
    startTaskWatch(req.dir); // (re)arm now that .dmworkspace exists
  });
```

- [ ] **Step 3: Expose the methods in preload/index.ts**

Add to the `api` object in `src/preload/index.ts` (after `readFile` on line 47):

```ts
  loadTasks: (dir: string) => ipcRenderer.invoke('tasks:load', dir) as Promise<import('../shared/tasks-markdown').TaskBoard>,
  saveTasks: (dir, board) => ipcRenderer.send('tasks:save', { dir, board }),
  onTasksChanged: (cb) => {
    const handler = (_e: unknown, p: { dir: string; board: import('../shared/tasks-markdown').TaskBoard }) => cb(p.dir, p.board);
    ipcRenderer.on('tasks:changed', handler);
    return () => ipcRenderer.removeListener('tasks:changed', handler);
  },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). If `require` triggers a lint/type error, replace the two `require(...)` calls with the already-imported `join`/`dirname` from `path` and `readFileSync` from `fs` (add `readFileSync` to the existing `node:fs` import on line 2 and `dirname` to the `path` import on line 3).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(tasks): IPC load/save + file watcher with echo-guard"
```

---

## Task 4: Renderer store slice (view toggle, board state, run actions)

**Files:**
- Modify: `src/renderer/store.ts`

- [ ] **Step 1: Add task state fields to the StoreState interface**

In `src/renderer/store.ts`, add to the `interface StoreState` (after `searchOpenPaneId: string | null;` on line 61):

```ts
  taskView: boolean;                 // true => board visible instead of terminals
  tasks: import('../shared/types').TaskBoard | null;
  tasksDir: string | null;           // working dir the loaded board belongs to
  openTaskView: () => Promise<void>;
  closeTaskView: () => void;
  reloadTasks: () => Promise<void>;
  applyTasksChanged: (dir: string, board: import('../shared/types').TaskBoard) => void;
  mutateTasks: (fn: (board: import('../shared/types').TaskBoard) => import('../shared/types').TaskBoard) => void;
  runTaskInPane: (paneId: string, text: string) => void;
  runTaskInNewPane: (text: string) => void;
```

- [ ] **Step 2: Add the initial values**

After `searchOpenPaneId: null,` on line 158 add:

```ts
  taskView: false,
  tasks: null,
  tasksDir: null,
```

- [ ] **Step 3: Implement the actions**

Add these implementations inside the store object (after `setSearchOpen` on line 351):

```ts
  openTaskView: async () => {
    const ws = get().activeWorkspace();
    if (!ws) return;
    const board = await window.api.loadTasks(ws.cwd);
    set({ taskView: true, tasks: board, tasksDir: ws.cwd });
  },
  closeTaskView: () => set({ taskView: false }),

  reloadTasks: async () => {
    const dir = get().tasksDir;
    if (!dir) return;
    set({ tasks: await window.api.loadTasks(dir) });
  },

  // Apply an external file change only when it matches the board we're showing.
  applyTasksChanged: (dir, board) => set((s) => (s.tasksDir === dir ? { tasks: board } : s)),

  // Local edit helper: transform the board, persist to TASKS.md, keep state in sync.
  mutateTasks: (fn) => set((s) => {
    if (!s.tasks || !s.tasksDir) return s;
    const tasks = fn(s.tasks);
    window.api.saveTasks(s.tasksDir, tasks);
    return { ...s, tasks };
  }),

  // Send a task's command/title into a running pane, then reveal terminals and
  // focus that pane. Uses the same input path as startup commands.
  runTaskInPane: (paneId, text) => {
    window.api.input({ paneId, data: `${text}\r` });
    set({ taskView: false, focusedPaneId: paneId });
    requestAnimationFrame(() => {
      // focusTerminal is imported lazily to avoid a cycle with TerminalView.
      void import('./terminal-registry').then((m) => m.focusTerminal(paneId));
    });
  },

  // Create a pane and stage the task text as a one-shot startup command, reusing
  // the proven consumeStartupCommand mechanism. Splits the focused pane (or makes
  // a single pane on the welcome screen).
  runTaskInNewPane: (text) => set((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (!ws) return s;
    const newPaneId = nextPaneId();
    let layout;
    if (!ws.layout) {
      layout = { type: 'pane', id: newPaneId } as const;
    } else {
      const ids = collectPaneIds(ws.layout);
      const target = s.focusedPaneId && ids.includes(s.focusedPaneId) ? s.focusedPaneId : ids[0];
      layout = splitPane(ws.layout, target, 'h', newPaneId, nextSplitId());
    }
    const pendingStartupCommands = { ...(ws.pendingStartupCommands ?? {}), [newPaneId]: text };
    const workspaces = s.workspaces.map((w) => w.id === ws.id ? { ...w, layout, pendingStartupCommands } : w);
    const next = { ...s, workspaces, taskView: false, focusedPaneId: newPaneId };
    persist(next);
    return next;
  }),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`splitPane`, `collectPaneIds`, `nextPaneId`, `nextSplitId`, `persist` are already imported/defined in this file.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/store.ts
git commit -m "feat(tasks): store slice for board view, edits and run actions"
```

---

## Task 4b: Workspace `tasksEnabled` flag + Aktivierungs-UI

Tasks sind opt-in pro Workspace (Default aus). Dieses Feld gatet den Titelleisten-Umschalter
(in Task 7) und wird hier samt UI eingeführt.

**Files:**
- Modify: `src/shared/types.ts:26-34` (Workspace interface)
- Modify: `src/renderer/store.ts` (setTasksEnabled action)
- Modify: `src/renderer/components/WelcomeScreen.tsx`
- Modify: `src/renderer/components/WorkspaceNavigation.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add the field to the Workspace type**

In `src/shared/types.ts`, add to the `Workspace` interface (after `pendingStartupCommands?` on line 33):

```ts
  tasksEnabled?: boolean; // opt-in: show the task board for this workspace (default off)
```

- [ ] **Step 2: Add a store action**

In `src/renderer/store.ts`, add to the `interface StoreState` near the other workspace actions (after `setWorkspaceCwd` on line 78):

```ts
  setTasksEnabled: (id: string, enabled: boolean) => void;
```

Add the implementation next to `setWorkspaceColor` (after line 364):

```ts
  setTasksEnabled: (id, enabled) => set((s) => {
    const workspaces = s.workspaces.map((w) => w.id === id ? { ...w, tasksEnabled: enabled } : w);
    // If the active workspace just lost tasks, leave the board view.
    const taskView = s.taskView && !(s.activeWorkspaceId === id && !enabled);
    const next = { ...s, workspaces, taskView };
    persist(next);
    return next;
  }),
```

- [ ] **Step 3: Add the checkbox to the Welcome screen**

In `src/renderer/components/WelcomeScreen.tsx`, add a selector inside the component (after line 21):

```tsx
  const setTasksEnabled = useStore((s) => s.setTasksEnabled);
  const tasksEnabled = useStore((s) => s.workspaces.find((w) => w.id === workspaceId)?.tasksEnabled ?? false);
```

Add the checkbox right after the `welcome-cwd` block (after line 35, before `<div className="preset-row">`):

```tsx
      <label className="welcome-tasks-toggle">
        <input type="checkbox" checked={tasksEnabled}
               onChange={(e) => setTasksEnabled(workspaceId, e.target.checked)} />
        Tasks für diesen Workspace aktivieren
      </label>
```

- [ ] **Step 4: Add the checkbox to the Workspace edit panel**

In `src/renderer/components/WorkspaceNavigation.tsx`, add a selector inside the component (after line 22):

```tsx
  const setTasksEnabled = useStore((s) => s.setTasksEnabled);
```

In the inline edit panel, add a row after the `ws-cwd` block (after its closing `</div>` on line 127, still inside `.ws-edit`):

```tsx
                <label className="ws-tasks-toggle" onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={w.tasksEnabled ?? false}
                         onChange={(e) => setTasksEnabled(w.id, e.target.checked)} />
                  Tasks aktivieren
                </label>
```

- [ ] **Step 5: Add styles**

Append to `src/renderer/styles.css`:

```css
.welcome-tasks-toggle { display: flex; align-items: center; gap: 8px; margin: 8px 0 16px; color: #ccd; font-size: 13px; cursor: pointer; }
.ws-tasks-toggle { display: flex; align-items: center; gap: 6px; margin-top: 6px; color: #ccd; font-size: 12px; cursor: pointer; }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/renderer/store.ts src/renderer/components/WelcomeScreen.tsx src/renderer/components/WorkspaceNavigation.tsx src/renderer/styles.css
git commit -m "feat(tasks): per-workspace tasksEnabled opt-in (welcome + edit panel)"
```

---

## Task 5: Focus registry + TerminalView registration

**Files:**
- Modify: `src/renderer/terminal-registry.ts`
- Modify: `src/renderer/components/TerminalView.tsx:287`

- [ ] **Step 1: Add a focus registry**

Append to `src/renderer/terminal-registry.ts`:

```ts
// Parallel registry: paneId -> focus the pane's xterm instance. Lets the task
// board focus a pane it doesn't own after sending a command into it.
const focusRegistry = new Map<string, () => void>();

export function registerTerminalFocus(paneId: string, focus: () => void): void {
  focusRegistry.set(paneId, focus);
}

export function unregisterTerminalFocus(paneId: string): void {
  focusRegistry.delete(paneId);
}

export function focusTerminal(paneId: string): void {
  focusRegistry.get(paneId)?.();
}
```

- [ ] **Step 2: Register/unregister focus in TerminalView**

In `src/renderer/components/TerminalView.tsx`, extend the existing registry import on line 14:

```ts
import { registerTerminal, unregisterTerminal, clearTerminal, clearTerminals, registerTerminalFocus, unregisterTerminalFocus } from '../terminal-registry';
```

Right after `registerTerminal(paneId, clearBuffer);` (line 287) add:

```ts
    registerTerminalFocus(paneId, () => term.focus());
```

In the cleanup return (right after `unregisterTerminal(paneId);` on line 366) add:

```ts
      unregisterTerminalFocus(paneId);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/terminal-registry.ts src/renderer/components/TerminalView.tsx
git commit -m "feat(tasks): pane focus registry for run-into-pane"
```

---

## Task 6: TaskCard + TaskBoard UI

**Files:**
- Create: `src/renderer/components/TaskCard.tsx`
- Create: `src/renderer/components/TaskBoard.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Implement TaskCard**

```tsx
// src/renderer/components/TaskCard.tsx
import React, { useState } from 'react';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import type { Task } from '../../shared/types';

interface Props {
  task: Task;
  columnIndex: number;
  taskIndex: number;
  onEdit: (patch: Partial<Pick<Task, 'title' | 'command'>>) => void;
  onDelete: () => void;
  onDragStart: (e: React.DragEvent) => void;
}

// One task card. The Run button targets the last-focused pane by default and
// exposes a picker (⌄) to choose another pane or spawn a new one.
export function TaskCard({ task, onEdit, onDelete, onDragStart }: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [command, setCommand] = useState(task.command ?? '');

  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const paneTitle = useStore((s) => s.paneTitle);
  const runTaskInPane = useStore((s) => s.runTaskInPane);
  const runTaskInNewPane = useStore((s) => s.runTaskInNewPane);

  const text = task.command && task.command.length ? task.command : task.title;
  const ws = activeWorkspace();
  const paneIds = collectPaneIds(ws?.layout ?? null);
  const defaultPane = focusedPaneId && paneIds.includes(focusedPaneId) ? focusedPaneId : paneIds[0];

  const commitEdit = (): void => {
    onEdit({ title: title.trim() || task.title, command: command.trim() || undefined });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="task-card task-card-editing">
        <input className="task-edit-title" autoFocus value={title}
               onChange={(e) => setTitle(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
               placeholder="Titel" />
        <input className="task-edit-cmd" value={command}
               onChange={(e) => setCommand(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
               placeholder="Befehl (optional)" />
        <div className="task-edit-actions">
          <button type="button" onClick={commitEdit}>Speichern</button>
          <button type="button" onClick={() => setEditing(false)}>Abbrechen</button>
        </div>
      </div>
    );
  }

  return (
    <div className="task-card" draggable onDragStart={onDragStart}>
      <div className="task-card-main" onDoubleClick={() => setEditing(true)}>
        <span className="task-title">{task.title}</span>
        {task.command && <code className="task-cmd">{task.command}</code>}
      </div>
      <div className="task-card-row">
        <div className="task-run">
          <button type="button" className="task-run-btn" disabled={!defaultPane}
                  title={defaultPane ? `In Pane senden: ${paneTitle(defaultPane, defaultPane)}` : 'Kein Pane vorhanden'}
                  onClick={() => defaultPane && runTaskInPane(defaultPane, text)}>
            ▶ Run{defaultPane ? ` → ${paneTitle(defaultPane, defaultPane)}` : ''}
          </button>
          <button type="button" className="task-run-caret" title="Ziel-Pane wählen"
                  onClick={() => setPicker((v) => !v)}>⌄</button>
          {picker && (
            <div className="task-pane-picker" onMouseLeave={() => setPicker(false)}>
              <div className="task-pane-picker-label">In welches Pane?</div>
              {paneIds.map((pid) => (
                <button type="button" key={pid} className="task-pane-item"
                        onClick={() => { runTaskInPane(pid, text); setPicker(false); }}>
                  <span>{paneTitle(pid, pid)}</span>
                </button>
              ))}
              <button type="button" className="task-pane-item task-pane-new"
                      onClick={() => { runTaskInNewPane(text); setPicker(false); }}>
                ＋ neues Pane
              </button>
            </div>
          )}
        </div>
        <button type="button" className="task-del" title="Löschen" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement TaskBoard**

```tsx
// src/renderer/components/TaskBoard.tsx
import React, { useState } from 'react';
import { useStore } from '../store';
import { TaskCard } from './TaskCard';
import type { Task, TaskBoard as Board } from '../../shared/types';

// Move a task from one (column, index) to the end of a target column. Returns a
// new board; pure so it stays easy to reason about.
function moveTask(board: Board, from: { col: number; idx: number }, toCol: number): Board {
  const columns = board.columns.map((c) => ({ ...c, tasks: [...c.tasks] }));
  const [moved] = columns[from.col].tasks.splice(from.idx, 1);
  if (!moved) return board;
  // "Done" column toggles the checkbox to match its name, mirroring the spec.
  const done = /done/i.test(columns[toCol].name);
  columns[toCol].tasks.push({ ...moved, done });
  return { columns };
}

export function TaskBoard(): React.JSX.Element {
  const tasks = useStore((s) => s.tasks);
  const mutateTasks = useStore((s) => s.mutateTasks);
  const [drag, setDrag] = useState<{ col: number; idx: number } | null>(null);

  if (!tasks) return <div className="task-board task-board-empty">Lade Tasks…</div>;

  const addTask = (col: number): void => mutateTasks((b) => {
    const columns = b.columns.map((c, i) =>
      i === col ? { ...c, tasks: [...c.tasks, { id: `new-${Date.now()}-${c.tasks.length}`, title: 'Neue Task', done: false } as Task] } : c);
    return { columns };
  });

  const editTask = (col: number, idx: number, patch: Partial<Pick<Task, 'title' | 'command'>>): void =>
    mutateTasks((b) => {
      const columns = b.columns.map((c, i) => i !== col ? c : {
        ...c, tasks: c.tasks.map((t, j) => j === idx ? { ...t, ...patch } : t)
      });
      return { columns };
    });

  const deleteTask = (col: number, idx: number): void => mutateTasks((b) => {
    const columns = b.columns.map((c, i) => i !== col ? c : { ...c, tasks: c.tasks.filter((_, j) => j !== idx) });
    return { columns };
  });

  const drop = (toCol: number): void => {
    if (!drag) return;
    mutateTasks((b) => moveTask(b, drag, toCol));
    setDrag(null);
  };

  return (
    <div className="task-board">
      {tasks.columns.map((col, ci) => (
        <div className="task-column" key={col.name + ci}
             onDragOver={(e) => e.preventDefault()} onDrop={() => drop(ci)}>
          <div className="task-column-head">
            <span>{col.name}</span>
            <button type="button" className="task-add" title="Task hinzufügen" onClick={() => addTask(ci)}>＋</button>
          </div>
          <div className="task-column-body">
            {col.tasks.map((t, ti) => (
              <TaskCard key={t.id} task={t} columnIndex={ci} taskIndex={ti}
                        onEdit={(patch) => editTask(ci, ti, patch)}
                        onDelete={() => deleteTask(ci, ti)}
                        onDragStart={() => setDrag({ col: ci, idx: ti })} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Append to `src/renderer/styles.css`:

```css
/* --- Task board --------------------------------------------------------- */
.task-board { display: flex; gap: 12px; padding: 14px; height: 100%; overflow: auto; box-sizing: border-box; }
.task-board-empty { color: var(--muted, #889); padding: 24px; }
.task-column { flex: 1; min-width: 200px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; display: flex; flex-direction: column; }
.task-column-head { display: flex; align-items: center; justify-content: space-between; padding: 8px 10px; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: #ccd; border-bottom: 1px solid rgba(255,255,255,0.06); }
.task-add, .task-del, .task-run-caret { background: none; border: none; color: inherit; cursor: pointer; opacity: .7; }
.task-add:hover, .task-del:hover, .task-run-caret:hover { opacity: 1; }
.task-column-body { padding: 8px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.task-card { background: #2c2c36; border: 1px solid #3a3a44; border-radius: 6px; padding: 8px; }
.task-card-main { cursor: grab; }
.task-title { display: block; color: #dde; font-size: 13px; }
.task-cmd { display: inline-block; margin-top: 4px; font-size: 11px; color: #7a8; background: rgba(0,0,0,0.25); padding: 1px 5px; border-radius: 3px; }
.task-card-row { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; }
.task-run { position: relative; display: flex; align-items: center; gap: 2px; }
.task-run-btn { background: #2f4a3a; color: #8fd; border: 1px solid #3f6a4a; border-radius: 4px; padding: 2px 8px; font-size: 11px; cursor: pointer; }
.task-run-btn:disabled { opacity: .4; cursor: default; }
.task-pane-picker { position: absolute; top: 100%; left: 0; margin-top: 4px; z-index: 20; background: #23232c; border: 1px solid #4a4a55; border-radius: 6px; box-shadow: 0 6px 20px rgba(0,0,0,.6); padding: 4px; min-width: 170px; }
.task-pane-picker-label { font-size: 10px; color: #889; text-transform: uppercase; padding: 3px 7px; }
.task-pane-item { display: flex; width: 100%; text-align: left; background: none; border: none; color: #dde; padding: 5px 7px; border-radius: 4px; cursor: pointer; }
.task-pane-item:hover { background: #3a4a6a; }
.task-pane-new { color: #8fd; }
.task-card-editing { display: flex; flex-direction: column; gap: 6px; }
.task-edit-title, .task-edit-cmd { background: #1c1c22; border: 1px solid #3a3a44; border-radius: 4px; color: #dde; padding: 4px 6px; font-size: 12px; }
.task-edit-actions { display: flex; gap: 6px; }
.task-edit-actions button { background: #333; border: 1px solid #444; color: #dde; border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; }
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/TaskCard.tsx src/renderer/components/TaskBoard.tsx src/renderer/styles.css
git commit -m "feat(tasks): task board + card UI with run/picker/drag"
```

---

## Task 7: Wire toggle + render the board

**Files:**
- Modify: `src/renderer/components/TitlebarActions.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/styles.css`

- [ ] **Step 1: Add the Terminals ⇄ Tasks toggle**

Replace the body of `src/renderer/components/TitlebarActions.tsx` with:

```tsx
import React from 'react';
import { useStore } from '../store';
import { Icon } from './Icon';

export function TitlebarActions(): React.JSX.Element {
  const togglePreview = useStore((s) => s.togglePreview);
  const previewOpen = useStore((s) => s.previewPanel.open);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const setCommandPaletteOpen = useStore((s) => s.setCommandPaletteOpen);
  const updateAvailable = useStore((s) => s.update.status === 'available');
  const taskView = useStore((s) => s.taskView);
  const openTaskView = useStore((s) => s.openTaskView);
  const closeTaskView = useStore((s) => s.closeTaskView);
  // The board toggle only exists when the active workspace has tasks enabled.
  const tasksEnabled = useStore((s) => s.activeWorkspace()?.tasksEnabled ?? false);

  return (
    <div className="titlebar-actions">
      {tasksEnabled && (
        <div className="view-toggle" role="tablist" aria-label="Ansicht">
          <button type="button" role="tab" aria-selected={!taskView}
                  className={`view-toggle-btn ${!taskView ? 'active' : ''}`}
                  onClick={closeTaskView}>Terminals</button>
          <button type="button" role="tab" aria-selected={taskView}
                  className={`view-toggle-btn ${taskView ? 'active' : ''}`}
                  onClick={() => void openTaskView()}>Tasks</button>
        </div>
      )}
      <button type="button" className="icon-btn" title="Command palette" onClick={() => setCommandPaletteOpen(true)}>
        <Icon name="command-palette" />
      </button>
      <button type="button" className={`icon-btn ${previewOpen ? 'active' : ''}`} title="Vorschau / Browser umschalten" aria-pressed={previewOpen} onClick={togglePreview}>
        <Icon name="preview" />
      </button>
      <button type="button" className="icon-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
        <Icon name="settings" />
        {updateAvailable && <span className="update-dot" title="Update available" />}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Render the board over the (still-mounted) terminals in App.tsx**

In `src/renderer/App.tsx`, add the import (after line 4, the WorkspaceView import):

```tsx
import { TaskBoard } from './components/TaskBoard';
```

Add a selector and the change-subscription effect. After line 20 (`const workspaceNavigationPlacement = ...`) add:

```tsx
  const taskView = useStore((s) => s.taskView);
  const applyTasksChanged = useStore((s) => s.applyTasksChanged);
  const tasksEnabled = useStore((s) => s.activeWorkspace()?.tasksEnabled ?? false);
  // Board shows only when toggled on AND the active workspace opted in. Guards the
  // case where you switch to a non-task workspace while the board is open.
  const showBoard = taskView && tasksEnabled;
```

After the focus effect (line 39) add:

```tsx
  // Live-update the board when TASKS.md changes outside the app.
  useEffect(() => window.api.onTasksChanged(applyTasksChanged), [applyTasksChanged]);
```

Then change the `left` branch (lines 57-61) so the terminals are hidden — not unmounted — while the board shows. Replace:

```tsx
          <>
            <WorkspaceNavigation placement="left" />
            <WorkspaceView />
          </>
```

with:

```tsx
          <>
            <WorkspaceNavigation placement="left" />
            <div className="view-stack">
              <div className="view-pane" style={{ display: showBoard ? 'none' : 'block' }}>
                <WorkspaceView />
              </div>
              {showBoard && <div className="view-pane"><TaskBoard /></div>}
            </div>
          </>
```

And the `top` branch (lines 63-66). Replace:

```tsx
          <div className="workspace-shell">
            <WorkspaceNavigation placement="top" />
            <WorkspaceView />
          </div>
```

with:

```tsx
          <div className="workspace-shell">
            <WorkspaceNavigation placement="top" />
            <div className="view-stack">
              <div className="view-pane" style={{ display: showBoard ? 'none' : 'block' }}>
                <WorkspaceView />
              </div>
              {showBoard && <div className="view-pane"><TaskBoard /></div>}
            </div>
          </div>
```

- [ ] **Step 3: Add layout styles**

Append to `src/renderer/styles.css`:

```css
.view-stack { position: relative; flex: 1; min-width: 0; display: flex; }
.view-pane { flex: 1; min-width: 0; }
.view-toggle { display: inline-flex; border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; overflow: hidden; margin-right: 8px; -webkit-app-region: no-drag; }
.view-toggle-btn { background: transparent; border: none; color: #99a; padding: 3px 10px; font-size: 12px; cursor: pointer; }
.view-toggle-btn.active { background: #3a4a6a; color: #fff; }
```

- [ ] **Step 4: Verify the build and typecheck**

Run: `npm run typecheck && npm run build`
Expected: both PASS.

- [ ] **Step 5: Manual smoke check**

Run: `npm run dev`
Verify: click **Tasks** in the titlebar → 3-column board appears; the terminal grid is hidden but still alive (switch back to **Terminals** → same shells, no respawn). Add a task, double-click to edit a title + command, drag it between columns. Confirm `<workspace-cwd>/.dmworkspace/TASKS.md` now exists and reflects the board, and that `.dmworkspace/` was added to `.gitignore`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/TitlebarActions.tsx src/renderer/App.tsx src/renderer/styles.css
git commit -m "feat(tasks): titlebar toggle and board view wiring"
```

---

## Task 8: End-to-end test

**Files:**
- Create: `e2e/task-board.spec.ts`

Look at `e2e/clear-context-menu.spec.ts` and `e2e/restart-scrollback.spec.ts` first to copy the existing Electron launch/setup helpers (how they boot the app, set a workspace cwd, and locate panes). Reuse that harness verbatim — do not invent a new bootstrap.

- [ ] **Step 1: Write the e2e test**

```ts
// e2e/task-board.spec.ts
import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// NOTE: mirror the launch/setup helper used by e2e/clear-context-menu.spec.ts
// (build dir, env, and the steps that create a workspace pointing at `dir`).

test('task board: create persists to TASKS.md, external edit updates board, run sends to pane', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmtask-e2e-'));
  mkdirSync(join(dir, '.git')); // so the gitignore path is exercised

  const app = await electron.launch({ args: ['out/main/index.js'] }); // adjust to match the existing helper
  const win = await app.firstWindow();

  // --- set the active workspace cwd to `dir` using the same UI flow the other
  // specs use (pick directory / template).

  // Tasks are opt-in: tick the activation checkbox on the welcome screen, which
  // makes the titlebar Tasks tab appear. Then open the board:
  await win.getByLabel('Tasks für diesen Workspace aktivieren').check();
  await win.getByRole('tab', { name: 'Tasks' }).click();
  await expect(win.locator('.task-board')).toBeVisible();

  // Create a task in the first column and give it a title.
  await win.locator('.task-column').first().locator('.task-add').click();
  const card = win.locator('.task-card').first();
  await card.dblclick();
  await win.locator('.task-edit-title').fill('e2e task');
  await win.getByRole('button', { name: 'Speichern' }).click();

  // It lands in TASKS.md and .dmworkspace/ is gitignored.
  await expect.poll(() => existsSync(join(dir, '.dmworkspace', 'TASKS.md'))).toBe(true);
  expect(readFileSync(join(dir, '.dmworkspace', 'TASKS.md'), 'utf8')).toContain('e2e task');
  expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.dmworkspace/');

  // External edit shows up in the board (bidirectional watch).
  writeFileSync(join(dir, '.dmworkspace', 'TASKS.md'), '## Todo\n- [ ] from-disk\n## Doing\n## Done', 'utf8');
  await expect(win.locator('.task-card', { hasText: 'from-disk' })).toBeVisible();

  await app.close();
});
```

- [ ] **Step 2: Run the e2e test**

Run: `npm run e2e -- task-board`
Expected: PASS. If the launch helper differs, align the boot + cwd-setup lines with the existing spec you copied from; keep the assertions.

- [ ] **Step 3: Commit**

```bash
git add e2e/task-board.spec.ts
git commit -m "test(e2e): task board create/watch/run flow"
```

---

## Final verification

- [ ] Run the full unit suite: `npm test` — Expected: PASS (incl. the two new files).
- [ ] Run typecheck: `npm run typecheck` — Expected: PASS.
- [ ] Run e2e: `npm run e2e` — Expected: PASS.
- [ ] Manual: in `npm run dev`, confirm switching Terminals⇄Tasks does NOT respawn shells, Run lands in the chosen pane and returns to terminals focused, and the picker's "＋ neues Pane" spawns a pane that auto-runs the task text.
- [ ] Manual (opt-in): a brand-new workspace shows NO Tasks tab until its welcome-screen checkbox is ticked; toggling the checkbox in the workspace edit panel shows/hides the tab; switching to a non-task workspace while the board is open falls back to terminals.
```
