export interface Task {
  id: string;        // ephemeral, assigned at parse time; not persisted to markdown
  title: string;
  description?: string; // optional, multiline (lines joined with \n); persisted as indented continuation lines
  command?: string;  // optional run command (trailing inline `code`). When absent, the consumer (Run button) sends the title instead — this module does not fall back.
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
// Trailing inline-code command: "title `command`" → ['title', 'command'].
// Only the LAST backtick span is treated as the command; any earlier inline-code
// spans remain part of the title.
const TRAILING_CMD = /^(.*)\s*`([^`]+)`\s*$/;

// Parse a TASKS.md document into a board. Headings (##) become columns, checkbox
// list items become tasks. Tolerant: unknown headings are kept; non-matching lines
// are ignored. Empty input yields the three default columns.
export function parseTasks(md: string): TaskBoard {
  const columns: TaskColumn[] = [];
  let current: TaskColumn | null = null;
  let currentTask: Task | null = null;
  let counter = 0;

  for (const rawLine of md.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '') { currentTask = null; continue; }
    const h = HEADING.exec(line);
    if (h) {
      current = { name: h[1], tasks: [] };
      columns.push(current);
      currentTask = null;
      continue;
    }
    const it = ITEM.exec(line);
    if (it && current) {
      const done = it[1].toLowerCase() === 'x';
      let title = it[2].trim();
      let command: string | undefined;
      const m = TRAILING_CMD.exec(title);
      if (m) { title = m[1].trim(); command = m[2].trim(); }
      currentTask = { id: `t${++counter}`, title, description: undefined, command, done };
      current.tasks.push(currentTask);
      continue;
    }
    // An indented, non-empty line that is neither heading nor item is a
    // continuation line: it belongs to the most recently opened task as
    // description. Strip the canonical 2-space prefix so the value round-trips
    // losslessly; join multiples with \n.
    if (currentTask && /^\s{2,}\S/.test(line)) {
      const text = line.replace(/^ {2}/, '');
      currentTask.description = currentTask.description ? `${currentTask.description}\n${text}` : text;
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
      if (t.description && t.description.trim()) {
        for (const dl of t.description.split('\n')) lines.push(`  ${dl}`);
      }
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n') + '\n';
}
