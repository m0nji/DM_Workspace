import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import type { WorkspaceNavigationPlacement } from '../../shared/types';
import { ConfirmDialog } from './ConfirmDialog';
import { ChangelogModal } from './ChangelogModal';
import { WorkspaceEditModal } from './WorkspaceEditModal';
import { Icon } from './Icon';
import { changelogVersions } from '../changelog-data';

interface WorkspaceNavigationProps {
  placement: WorkspaceNavigationPlacement;
}

export function WorkspaceNavigation({ placement }: WorkspaceNavigationProps): React.JSX.Element {
  const { t } = useTranslation();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const paneStatus = useStore((s) => s.paneStatus);
  const showDoneBadge = useStore((s) => s.settings.showDoneBadge ?? false);
  const activeId2 = useStore((s) => s.activeWorkspaceId);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);

  const pendingWs = pendingDeleteId
    ? workspaces.find((w) => w.id === pendingDeleteId)
    : undefined;
  const top = placement === 'top';
  const rootClass = top ? 'workspace-tabs' : 'sidebar';
  const itemClass = top ? 'workspace-tab' : 'ws-item';

  return (
    <div className={rootClass}>
      {!top && <div className="sidebar-header"><span>{t('workspace.sectionTitle')}</span></div>}
      {workspaces.map((w) => {
        const paneIds = collectPaneIds(w.layout);
        const count = paneIds.length;
        // Badge: number of "done" panes in INACTIVE workspaces (where you can't see them).
        const doneCount = !showDoneBadge || w.id === activeId2
          ? 0
          : paneIds.filter((pid) => paneStatus[pid] === 'done').length;
        return (
          <div
            key={w.id}
            className={`${itemClass} ${w.id === activeId ? 'active' : ''}`}
            onClick={() => selectWorkspace(w.id)}
            onDoubleClick={(e) => { e.preventDefault(); setEditingId(w.id); }}
          >
            <span className="dot" style={w.color ? { background: w.color } : undefined} />
            <span className="name">{w.name}</span>
            <span className="ws-end">
              <span className="ws-actions">
                <span
                  className="rename"
                  title={t('tooltip.editWorkspace')}
                  onClick={(e) => { e.stopPropagation(); setEditingId(w.id); }}
                ><Icon name="edit" size={14} /></span>
                <span
                  className="del"
                  title={t('tooltip.deleteWorkspace')}
                  onClick={(e) => { e.stopPropagation(); setPendingDeleteId(w.id); }}
                ><Icon name="close" size={14} /></span>
              </span>
              {doneCount > 0 && <span className="done-badge" title={t('tooltip.terminalsReady')}>{doneCount}</span>}
              <span className="badge">{count}</span>
            </span>
          </div>
        );
      })}
      <div
        className={top ? 'add-workspace-tab' : 'add-ws'}
        title={top ? t('tooltip.addWorkspace') : undefined}
        onClick={addWorkspace}
      >
        {top ? '+' : t('workspace.addWorkspace')}
      </div>

      {!top && (
        <div className="sidebar-footer">
          <button type="button" className="app-version" title={t('tooltip.whatsNewChangelog')}
                  onClick={() => setShowChangelog(true)}>v{__APP_VERSION__}</button>
        </div>
      )}

      {editingId && (
        <WorkspaceEditModal
          workspaceId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}

      {showChangelog && (
        <ChangelogModal
          title="What's new"
          versions={changelogVersions}
          highlightVersion={__APP_VERSION__}
          onClose={() => setShowChangelog(false)}
        />
      )}

      {pendingWs && (
        <ConfirmDialog
          title={t('workspace.deleteTitle')}
          message={t('workspace.deleteMessage', { name: pendingWs.name })}
          onConfirm={() => { deleteWorkspace(pendingWs.id); setPendingDeleteId(null); }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}
