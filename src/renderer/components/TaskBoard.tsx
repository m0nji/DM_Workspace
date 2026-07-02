// src/renderer/components/TaskBoard.tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { TaskCard } from './TaskCard';
import type { Task, TaskBoard as Board } from '../../shared/types';

// Move a task from one (column, index) to the end of a target column. Returns a
// new board; pure so it stays easy to reason about.
function moveTask(board: Board, from: { col: number; idx: number }, toCol: number): Board {
  if (from.col === toCol) return board; // dropping within the same column: no-op (no within-column reorder)
  const columns = board.columns.map((c) => ({ ...c, tasks: [...c.tasks] }));
  const [moved] = columns[from.col].tasks.splice(from.idx, 1);
  if (!moved) return board;
  // The last column counts as "done" (boards read left-to-right: Todo → … →
  // Done), so a renamed/localized final column ("Fertig", "Erledigt") still
  // checks tasks off. The name match keeps a "Done" column working when it
  // isn't last.
  const done = toCol === columns.length - 1 || /done/i.test(columns[toCol].name);
  columns[toCol].tasks.push({ ...moved, done });
  return { columns };
}

export function TaskBoard(): React.JSX.Element {
  const { t } = useTranslation();
  const tasks = useStore((s) => s.tasks);
  const mutateTasks = useStore((s) => s.mutateTasks);
  const [drag, setDrag] = useState<{ col: number; idx: number } | null>(null);

  if (!tasks) return <div className="task-board task-board-empty">{t('tasks.loading')}</div>;

  const addTask = (col: number): void => mutateTasks((b) => {
    const columns = b.columns.map((c, i) =>
      i === col ? { ...c, tasks: [...c.tasks, { id: `new-${Date.now()}-${c.tasks.length}`, title: t('tasks.newTask'), done: false } as Task] } : c);
    return { columns };
  });

  const editTask = (col: number, idx: number, patch: Partial<Pick<Task, 'title' | 'description' | 'command'>>): void =>
    mutateTasks((b) => {
      const columns = b.columns.map((c, i) => i !== col ? c : {
        ...c, tasks: c.tasks.map((task, j) => j === idx ? { ...task, ...patch } : task)
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
        <div className="task-column" key={ci}
             onDragOver={(e) => e.preventDefault()} onDrop={() => drop(ci)}>
          <div className="task-column-head">
            <span>{col.name}</span>
            <button type="button" className="task-add" title={t('tasks.add')} onClick={() => addTask(ci)}>＋</button>
          </div>
          <div className="task-column-body">
            {col.tasks.map((task, ti) => (
              <TaskCard key={task.id} task={task}
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
