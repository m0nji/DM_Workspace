// src/renderer/components/TaskCard.tsx
import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { collectPaneIds, panePositionLabel } from '../../shared/layout-tree';
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
  const [description, setDescription] = useState(task.description ?? '');

  // Keep the local edit buffers in sync with external changes (file watcher) while
  // the card is not being edited, so entering edit mode starts from current data.
  useEffect(() => {
    if (!editing) { setTitle(task.title); setDescription(task.description ?? ''); setCommand(task.command ?? ''); }
  }, [task.title, task.description, task.command, editing]);

  // Close the pane picker if the task loses its command (the run UI — and the
  // picker's own close handlers — unmount, so reset the state here).
  useEffect(() => { if (!task.command) setPicker(false); }, [task.command]);

  const activeWorkspace = useStore((s) => s.activeWorkspace);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const paneTitle = useStore((s) => s.paneTitle);
  const runTaskInPane = useStore((s) => s.runTaskInPane);
  const runTaskInNewPane = useStore((s) => s.runTaskInNewPane);

  const text = task.command ?? '';
  const ws = activeWorkspace();
  const paneIds = collectPaneIds(ws?.layout ?? null);
  const defaultPane = focusedPaneId && paneIds.includes(focusedPaneId) ? focusedPaneId : paneIds[0];

  // A readable name for a pane: the user's custom title if set, otherwise a
  // position label derived from the split layout ("Terminal oben", "Terminal
  // unten links", …) instead of the opaque pane id ("p18").
  const labelFor = (pid: string): string => {
    const pos = panePositionLabel(ws?.layout ?? null, pid);
    return paneTitle(pid, pos ? `Terminal ${pos}` : 'Terminal');
  };

  // The pane picker is positioned as a fixed overlay (not absolute) so it isn't
  // clipped by the task column's overflow:auto. We anchor it to the caret button
  // and flip upward when it would overflow the bottom of the viewport.
  const caretRef = useRef<HTMLButtonElement>(null);
  const [pickerStyle, setPickerStyle] = useState<React.CSSProperties>({});
  const togglePicker = (): void => {
    if (picker) { setPicker(false); return; }
    const r = caretRef.current?.getBoundingClientRect();
    if (r) {
      const estHeight = (paneIds.length + 2) * 32 + 12;
      const left = Math.min(r.left, window.innerWidth - 190);
      const openUp = r.bottom + estHeight > window.innerHeight && r.top - estHeight > 0;
      setPickerStyle(openUp
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: r.bottom + 4 });
    }
    setPicker(true);
  };

  const commitEdit = (): void => {
    onEdit({ title: title.trim() || task.title, description: description.trim() || undefined, command: command.trim() || undefined });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="task-card task-card-editing">
        <input className="task-edit-title" autoFocus value={title}
               onChange={(e) => setTitle(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditing(false); }}
               placeholder="Titel" />
        <textarea className="task-edit-desc" value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commitEdit(); if (e.key === 'Escape') setEditing(false); }}
                  placeholder="Beschreibung (optional)" rows={3} />
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
                    title={defaultPane ? `Ausführen in: ${labelFor(defaultPane)}` : 'Kein Terminal vorhanden'}
                    onClick={() => defaultPane && runTaskInPane(defaultPane, text)}>
              ▶ Run{defaultPane ? ` → ${labelFor(defaultPane)}` : ''}
            </button>
            <button type="button" ref={caretRef} className="task-run-caret" title="Ziel-Terminal wählen"
                    onClick={togglePicker}>⌄</button>
            {picker && (
              <>
                <div className="task-pane-backdrop" onClick={() => setPicker(false)} />
                <div className="task-pane-picker" style={pickerStyle}>
                  <div className="task-pane-picker-label">In welches Terminal?</div>
                  {paneIds.map((pid) => (
                    <button type="button" key={pid} className="task-pane-item"
                            onClick={() => { runTaskInPane(pid, text); setPicker(false); }}>
                      <span>{labelFor(pid)}</span>
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
