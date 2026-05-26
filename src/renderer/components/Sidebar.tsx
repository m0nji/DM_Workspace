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
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const updateAvailable = useStore((s) => s.update.status === 'available');

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

      <div className="sidebar-footer">
        <span className="app-version">v{__APP_VERSION__}</span>
        <button className="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2.5" y1="4" x2="13.5" y2="4" />
            <line x1="2.5" y1="8" x2="13.5" y2="8" />
            <line x1="2.5" y1="12" x2="13.5" y2="12" />
            <circle cx="6" cy="4" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="10.5" cy="8" r="1.7" fill="currentColor" stroke="none" />
            <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
          </svg>
          {updateAvailable && <span className="update-dot" title="Update available" />}
        </button>
      </div>
    </div>
  );
}
