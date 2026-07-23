import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';

// Shared palette for workspace dots. Kept here next to the editor since this is
// the only place a workspace's colour is chosen.
const WS_COLORS = ['#c97b4a', '#4a90c9', '#5cb85c', '#c95a5a', '#a05ac9', '#c9b34a'];

interface WorkspaceEditModalProps {
  workspaceId: string;
  onClose: () => void;
}

/**
 * Centered editor for a single workspace (name, colour, base folder, tasks).
 * Replaces the cramped inline panel that used to expand inside the sidebar row.
 * Built on the shared .modal-backdrop / .modal pattern: backdrop click and
 * Escape close, Enter commits the name.
 */
export function WorkspaceEditModal({ workspaceId, onClose }: WorkspaceEditModalProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const ws = useStore((s) => s.workspaces.find((w) => w.id === workspaceId));
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const setWorkspaceColor = useStore((s) => s.setWorkspaceColor);
  const setWorkspaceCwd = useStore((s) => s.setWorkspaceCwd);
  const setTasksEnabled = useStore((s) => s.setTasksEnabled);

  // Every field is buffered locally and applied only on "Done" — Cancel,
  // Escape and the backdrop discard ALL edits. (Colour/folder/tasks used to
  // write through immediately, which made the Cancel button a lie.)
  const [name, setName] = useState(ws?.name ?? '');
  const [color, setColor] = useState(ws?.color);
  const [cwd, setCwd] = useState(ws?.cwd ?? '');
  const [tasksEnabled, setTasks] = useState(ws?.tasksEnabled ?? false);
  // Folder picked while terminals are running — held until the user confirms
  // the restart in the in-app dialog below.
  const [pendingDir, setPendingDir] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Apply the buffered edits and close. Enter and the "Done" button share this;
  // an empty name is discarded so a workspace never loses its label. The cwd
  // goes last: it restarts the workspace's panes.
  const commit = (): void => {
    if (ws) {
      if (name.trim() && name.trim() !== ws.name) renameWorkspace(ws.id, name.trim());
      if (color && color !== ws.color) setWorkspaceColor(ws.id, color);
      if (tasksEnabled !== (ws.tasksEnabled ?? false)) setTasksEnabled(ws.id, tasksEnabled);
      if (cwd && cwd !== ws.cwd) setWorkspaceCwd(ws.id, cwd);
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // The restart confirm on top owns Enter/Escape (both dialogs listen on
      // window, so without this guard one keystroke would drive both).
      if (pendingDir) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'Enter') { e.preventDefault(); commit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, color, cwd, tasksEnabled, ws, pendingDir]);

  const chooseFolder = async (): Promise<void> => {
    if (!ws) return;
    const dir = await window.api.pickDirectory();
    if (!dir || dir === ws.cwd) { if (dir) setCwd(dir); return; }
    // Changing the folder restarts the workspace's open terminals in the new
    // directory (applied on "Done"), so confirm when there are panes to lose.
    // In-app ConfirmDialog, never window.confirm: Electron's native JS dialogs
    // leave the renderer with a dead caret and swallowed Space key until the
    // window loses OS focus (electron/electron#41603).
    const hasPanes = collectPaneIds(ws.layout ?? null).length > 0;
    if (hasPanes) { setPendingDir(dir); return; }
    setCwd(dir);
  };

  if (!ws) return null;

  return (
    <>
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal ws-edit-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{t('workspace.edit.title')}</span>
          <button type="button" className="modal-close" title={t('common.close')} onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="ws-edit-field">
          <div className="modal-section-label">{t('workspace.edit.name')}</div>
          <input
            ref={inputRef}
            className="ws-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="ws-edit-field">
          <div className="modal-section-label">{t('workspace.edit.color')}</div>
          <div className="ws-edit-swatches">
            {WS_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`ws-edit-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                title={t('workspace.edit.setColor')}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>

        <div className="ws-edit-field">
          <div className="modal-section-label">{t('workspace.edit.baseFolder')}</div>
          <div className="ws-edit-folder">
            <code className="ws-edit-folder-path" title={cwd}>{cwd}</code>
            <button type="button" className="ws-edit-folder-btn" onClick={() => void chooseFolder()}>
              <Icon name="folder" size={15} />
              {t('common.change')}
            </button>
          </div>
        </div>

        <label className="ws-edit-tasks">
          <input
            type="checkbox"
            checked={tasksEnabled}
            onChange={(e) => setTasks(e.target.checked)}
          />
          {t('workspace.edit.enableTasks')}
        </label>

        <div className="ws-edit-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" onClick={commit}>{t('common.done')}</button>
        </div>
      </div>
    </div>

    {/* Sibling of the editor backdrop, not a child: a click on this dialog's
        own backdrop must not bubble into the editor's backdrop and close it. */}
    {pendingDir && (
      <ConfirmDialog
        title={t('workspace.folderRestartTitle')}
        message={t('workspace.folderRestartConfirm')}
        confirmLabel={t('workspace.folderRestartAction')}
        onConfirm={() => { setCwd(pendingDir); setPendingDir(null); }}
        onCancel={() => setPendingDir(null)}
      />
    )}
    </>
  );
}
