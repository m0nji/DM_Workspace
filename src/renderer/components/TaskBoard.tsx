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
