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
  const togglePreview = useStore((s) => s.togglePreview);
  const previewOpen = useStore((s) => s.previewPanel.open);

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
    if (!dir) return;
    // Changing the folder restarts the workspace's open terminals in the new
    // directory, so confirm first when there are running panes to lose.
    const ws = workspaces.find((w) => w.id === id);
    const hasPanes = collectPaneIds(ws?.layout ?? null).length > 0;
    if (hasPanes && !window.confirm(
      'Diesen Workspace im neuen Ordner neu starten? Die laufenden Terminals werden beendet.'
    )) return;
    setWorkspaceCwd(id, dir);
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
        <button
          type="button"
          className={`preview-toggle-btn ${previewOpen ? 'active' : ''}`}
          title="Vorschau / Browser umschalten"
          onClick={togglePreview}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <line x1="9.5" y1="3.5" x2="9.5" y2="12.5" />
          </svg>
        </button>
        <button className="settings-btn" title="Settings" onClick={() => setSettingsOpen(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {updateAvailable && <span className="update-dot" title="Update available" />}
        </button>
      </div>
    </div>
  );
}
