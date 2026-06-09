// src/renderer/components/TaskCard.tsx
import React, { useState, useEffect } from 'react';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import type { Task } from '../../shared/types';

interface Props {
  task: Task;
  onEdit: (patch: Partial<Pick<Task, 'title' | 'description' | 'command'>>) => void;
  onDelete: () => void;
  onDragStart: () => void;
}

// One task card. The Run button targets the last-focused pane by default and
// exposes a picker (⌄) to choose another pane or spawn a new one.
export function TaskCard({ task, onEdit, onDelete, onDragStart }: Props): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [picker, setPicker] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [command, setCommand] = useState(task.command ?? '');

  // Keep the local edit buffers in sync with external changes (file watcher) while
  // the card is not being edited, so entering edit mode starts from current data.
  useEffect(() => {
    if (!editing) { setTitle(task.title); setCommand(task.command ?? ''); }
  }, [task.title, task.command, editing]);

  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const paneTitle = useStore((s) => s.paneTitle);
  const runTaskInPane = useStore((s) => s.runTaskInPane);
  const runTaskInNewPane = useStore((s) => s.runTaskInNewPane);

  const text = task.command ?? '';
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
        {task.description && <div className="task-desc">{task.description}</div>}
        {task.command && <code className="task-cmd">{task.command}</code>}
      </div>
      <div className="task-card-row">
        {task.command ? (
          <div className="task-run">
            <button type="button" className="task-run-btn" disabled={!defaultPane}
                    title={defaultPane ? `In Pane senden: ${paneTitle(defaultPane, defaultPane)}` : 'Kein Pane vorhanden'}
                    onClick={() => defaultPane && runTaskInPane(defaultPane, text)}>
              ▶ Run{defaultPane ? ` → ${paneTitle(defaultPane, defaultPane)}` : ''}
            </button>
            <button type="button" className="task-run-caret" title="Ziel-Pane wählen"
                    onClick={() => setPicker((v) => !v)}>⌄</button>
            {picker && (
              <>
                <div className="task-pane-backdrop" onClick={() => setPicker(false)} />
                <div className="task-pane-picker">
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
              </>
            )}
          </div>
        ) : (
          <span className="task-no-cmd">— kein Befehl —</span>
        )}
        <button type="button" className="task-del" title="Löschen" onClick={onDelete}>✕</button>
      </div>
    </div>
  );
}
