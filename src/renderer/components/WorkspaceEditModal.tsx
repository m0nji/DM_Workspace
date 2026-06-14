import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
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

  const [name, setName] = useState(ws?.name ?? '');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Commit the (trimmed) name and close. Enter and the "Done" button share
  // this; an empty name is discarded so a workspace never loses its label.
  const commit = (): void => {
    if (ws && name.trim()) renameWorkspace(ws.id, name.trim());
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'Enter') { e.preventDefault(); commit(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, ws]);

  const chooseFolder = async (): Promise<void> => {
    if (!ws) return;
    const dir = await window.api.pickDirectory();
    if (!dir) return;
    // Changing the folder restarts the workspace's open terminals in the new
    // directory, so confirm first when there are running panes to lose.
    const hasPanes = collectPaneIds(ws.layout ?? null).length > 0;
    if (hasPanes && !window.confirm(t('workspace.folderRestartConfirm'))) return;
    setWorkspaceCwd(ws.id, dir);
  };

  if (!ws) return null;

  return (
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
                className={`ws-edit-swatch ${ws.color === c ? 'active' : ''}`}
                style={{ background: c }}
                title={t('workspace.edit.setColor')}
                onClick={() => setWorkspaceColor(ws.id, c)}
              />
            ))}
          </div>
        </div>

        <div className="ws-edit-field">
          <div className="modal-section-label">{t('workspace.edit.baseFolder')}</div>
          <div className="ws-edit-folder">
            <code className="ws-edit-folder-path" title={ws.cwd}>{ws.cwd}</code>
            <button type="button" className="ws-edit-folder-btn" onClick={() => void chooseFolder()}>
              <Icon name="folder" size={15} />
              {t('common.change')}
            </button>
          </div>
        </div>

        <label className="ws-edit-tasks">
          <input
            type="checkbox"
            checked={ws.tasksEnabled ?? false}
            onChange={(e) => setTasksEnabled(ws.id, e.target.checked)}
          />
          {t('workspace.edit.enableTasks')}
        </label>

        <div className="ws-edit-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
          <button type="button" className="btn-primary" onClick={commit}>{t('common.done')}</button>
        </div>
      </div>
    </div>
  );
}
