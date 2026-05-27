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
  const paneStatus = useStore((s) => s.paneStatus);
  const showDoneBadge = useStore((s) => s.settings.showDoneBadge ?? false);
  const activeId2 = useStore((s) => s.activeWorkspaceId);
  const setWorkspaceColor = useStore((s) => s.setWorkspaceColor);
  const setWorkspaceCwd = useStore((s) => s.setWorkspaceCwd);

  const WS_COLORS = ['#c97b4a', '#4a90c9', '#5cb85c', '#c95a5a', '#a05ac9', '#c9b34a'];

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

  const chooseFolder = async (id: string) => {
    const dir = await window.api.pickDirectory();
    if (dir) setWorkspaceCwd(id, dir);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header"><span>WORKSPACES</span></div>
      {workspaces.map((w) => {
        const paneIds = collectPaneIds(w.layout);
        const count = paneIds.length;
        // Badge: number of "done" panes in INACTIVE workspaces (where you can't see them).
        const doneCount = !showDoneBadge || w.id === activeId2
          ? 0
          : paneIds.filter((pid) => paneStatus[pid] === 'done').length;
        const editing = editingId === w.id;
        return (
          <div
            key={w.id}
            className={`ws-item ${w.id === activeId ? 'active' : ''}`}
            onClick={() => { if (!editing) selectWorkspace(w.id); }}
            onDoubleClick={(e) => { e.preventDefault(); startEdit(w.id, w.name); }}
          >
            <span className="dot" style={w.color ? { background: w.color } : undefined} />
            {editing ? (
              <div className="ws-edit" onMouseDown={(e) => e.stopPropagation()}>
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
                />
                <div className="ws-colors" onMouseDown={(e) => e.preventDefault()}>
                  {WS_COLORS.map((c) => (
                    <span
                      key={c}
                      className={`ws-color ${w.color === c ? 'active' : ''}`}
                      style={{ background: c }}
                      title="Set color"
                      onClick={(e) => { e.stopPropagation(); setWorkspaceColor(w.id, c); }}
                    />
                  ))}
                </div>
                <div className="ws-cwd" onMouseDown={(e) => e.preventDefault()}>
                  <code className="ws-cwd-path" title={w.cwd}>{w.cwd}</code>
                  <button
                    type="button"
                    className="ws-cwd-btn"
                    title="Change base folder"
                    onClick={(e) => { e.stopPropagation(); void chooseFolder(w.id); }}
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                         strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4.5Z" />
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <span className="name">{w.name}</span>
                {doneCount > 0 && <span className="done-badge" title="Terminals ready">{doneCount}</span>}
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
