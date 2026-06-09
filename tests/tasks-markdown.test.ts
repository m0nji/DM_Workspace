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

  it('tolerates CRLF line endings', () => {
    const board = parseTasks('## Todo\r\n- [ ] task `cmd`\r\n');
    expect(board.columns[0].name).toBe('Todo');
    expect(board.columns[0].tasks[0]).toMatchObject({ title: 'task', command: 'cmd', done: false });
  });

  it('round-trips through serialize without losing data', () => {
    const md = '## Todo\n- [ ] a `ls -la`\n- [x] b\n\n## Doing\n\n## Done\n- [x] c';
    const board = parseTasks(md);
    const reparsed = parseTasks(serializeTasks(board));
    const strip = (b: ReturnType<typeof parseTasks>) =>
      b.columns.map((c) => ({ name: c.name, tasks: c.tasks.map(({ title, command, done }) => ({ title, command, done })) }));
    expect(strip(reparsed)).toEqual(strip(board));
  });

  it('parses an indented continuation line as the task description', () => {
    const board = parseTasks('## Todo\n- [ ] Tunnel öffnen `ssh x`\n  Erklärt den Schritt.');
    expect(board.columns[0].tasks[0]).toMatchObject({
      title: 'Tunnel öffnen', command: 'ssh x', description: 'Erklärt den Schritt.', done: false,
    });
  });

  it('joins multiple indented lines into a multiline description', () => {
    const board = parseTasks('## Todo\n- [ ] A\n  Zeile eins.\n  Zeile zwei.');
    expect(board.columns[0].tasks[0].description).toBe('Zeile eins.\nZeile zwei.');
  });

  it('leaves description undefined when there is no continuation line', () => {
    const board = parseTasks('## Todo\n- [ ] A `cmd`');
    expect(board.columns[0].tasks[0].description).toBeUndefined();
  });

  it('ignores an indented line that has no preceding task', () => {
    const board = parseTasks('## Todo\n  orphan line\n- [ ] A');
    expect(board.columns[0].tasks).toHaveLength(1);
    expect(board.columns[0].tasks[0]).toMatchObject({ title: 'A', description: undefined });
  });

  it('round-trips a description (single and multiline) through serialize', () => {
    const md = '## Todo\n- [ ] A `ls`\n  one line\n- [ ] B\n  line 1\n  line 2\n';
    const board = parseTasks(md);
    const reparsed = parseTasks(serializeTasks(board));
    const strip = (b: ReturnType<typeof parseTasks>) =>
      b.columns.map((c) => ({ name: c.name, tasks: c.tasks.map(({ title, description, command, done }) => ({ title, description, command, done })) }));
    expect(strip(reparsed)).toEqual(strip(board));
  });

  it('does not attach an indented line across a blank line', () => {
    const board = parseTasks('## Todo\n- [ ] A\n\n  stray');
    expect(board.columns[0].tasks[0].description).toBeUndefined();
  });

  it('round-trips a description whose line begins with spaces', () => {
    const board = parseTasks('## Todo\n- [ ] A\n    indented note');
    expect(board.columns[0].tasks[0].description).toBe('  indented note');
    const reparsed = parseTasks(serializeTasks(board));
    expect(reparsed.columns[0].tasks[0].description).toBe('  indented note');
  });

  it('round-trips a description that contains a blank line', () => {
    const board = parseTasks('## Todo\n- [ ] A\n  para 1\n  \n  para 2');
    expect(board.columns[0].tasks[0].description).toBe('para 1\n\npara 2');
    const reparsed = parseTasks(serializeTasks(board));
    expect(reparsed.columns[0].tasks[0].description).toBe('para 1\n\npara 2');
  });

  it('still treats a non-indented blank line as a description terminator', () => {
    const board = parseTasks('## Todo\n- [ ] A\n\n  stray');
    expect(board.columns[0].tasks[0].description).toBeUndefined();
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

  it('writes the description as indented continuation lines', () => {
    const board = parseTasks('## Todo\n- [ ] A `cmd`\n  erste Zeile\n  zweite Zeile');
    const out = serializeTasks(board);
    expect(out).toContain('- [ ] A `cmd`');
    expect(out).toContain('  erste Zeile');
    expect(out).toContain('  zweite Zeile');
  });
});
