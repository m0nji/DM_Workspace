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
