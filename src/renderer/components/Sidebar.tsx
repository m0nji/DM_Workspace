import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';

export function Sidebar(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + select the field when entering edit mode (more reliable than autoFocus
  // when the input is conditionally rendered inside a list that re-renders).
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const startEdit = (id: string, name: string) => {
    setDraft(name);
    setEditingId(id);
  };
  const commit = () => {
    if (editingId && draft.trim()) renameWorkspace(editingId, draft.trim());
    setEditingId(null);
  };
  const cancel = () => setEditingId(null);

  return (
    <div className="sidebar">
      <div className="sidebar-header"><span>WORKSPACES</span></div>
      {workspaces.map((w) => {
        const count = collectPaneIds(w.layout).length;
        const editing = editingId === w.id;
        return (
          <div
            key={w.id}
            className={`ws-item ${w.id === activeId ? 'active' : ''}`}
            onClick={() => { if (!editing) selectWorkspace(w.id); }}
            onDoubleClick={(e) => { e.preventDefault(); startEdit(w.id, w.name); }}
          >
            <span className="dot" />
            {editing ? (
              <input
                ref={inputRef}
                className="ws-rename-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commit();
                  else if (e.key === 'Escape') cancel();
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="name">{w.name}</span>
                <span className="badge">{count}</span>
                <span
                  className="rename"
                  title="Rename workspace"
                  onClick={(e) => { e.stopPropagation(); startEdit(w.id, w.name); }}
                >✎</span>
                <span
                  className="del"
                  title="Delete workspace"
                  onClick={(e) => { e.stopPropagation(); deleteWorkspace(w.id); }}
                >✕</span>
              </>
            )}
          </div>
        );
      })}
      <div className="add-ws" onClick={addWorkspace}>+ Workspace</div>
    </div>
  );
}
