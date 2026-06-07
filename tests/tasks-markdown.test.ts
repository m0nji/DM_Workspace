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
