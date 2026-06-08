import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { tasksFilePath, loadTasks, saveTasks, ensureGitignore } from '../src/main/task-store';
import { parseTasks } from '../src/shared/tasks-markdown';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'dmtasks-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('tasksFilePath', () => {
  it('points at .dmworkspace/TASKS.md inside the working dir', () => {
    expect(tasksFilePath(dir)).toBe(join(dir, '.dmworkspace', 'TASKS.md'));
  });
  // A freshly created workspace defaults its cwd to the literal string '~'
  // (store.ts). The OS never expands '~', so paths built from it must resolve to
  // the home dir — otherwise mkdir '~/.dmworkspace' crashes the main process.
  it('expands a leading ~ to the home directory', () => {
    expect(tasksFilePath('~')).toBe(join(homedir(), '.dmworkspace', 'TASKS.md'));
    expect(tasksFilePath('~/proj')).toBe(join(homedir(), 'proj', '.dmworkspace', 'TASKS.md'));
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
  it('appends on a new line when the existing .gitignore has no trailing newline', () => {
    mkdirSync(join(dir, '.git'));
    writeFileSync(join(dir, '.gitignore'), 'node_modules', 'utf8'); // no trailing \n
    ensureGitignore(dir);
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toBe('node_modules\n.dmworkspace/\n');
  });
});
