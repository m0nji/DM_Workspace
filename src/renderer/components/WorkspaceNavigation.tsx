import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import type { ServerConfig, WorkspaceNavigationPlacement } from '../../shared/types';
import { ConfirmDialog } from './ConfirmDialog';
import { ChangelogModal } from './ChangelogModal';
import { WorkspaceEditModal } from './WorkspaceEditModal';
import { Icon } from './Icon';
import { changelogVersions } from '../changelog-data';
import { remoteServerName } from '../remote-server-label';

interface WorkspaceNavigationProps {
  placement: WorkspaceNavigationPlacement;
}

// Zustand 5 memoisiert Selektoren nicht: `s.settings.servers ?? []` liefert ohne
// konfigurierten Server bei JEDER Momentaufnahme ein neues Array und würde die
// Navigation bei jedem Store-Ereignis neu rendern — genau das, was die
// paneStatus-Optimierung unten vermeidet. Eine feste Konstante bleibt identisch.
const NO_SERVERS: ServerConfig[] = [];

export function WorkspaceNavigation({ placement }: WorkspaceNavigationProps): React.JSX.Element {
  const { t } = useTranslation();
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const reorderWorkspace = useStore((s) => s.reorderWorkspace);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const servers = useStore((s) => s.settings.servers ?? NO_SERVERS);
  const hasServers = servers.length > 0;
  const setRemoteDialogOpen = useStore((s) => s.setRemoteWorkspaceDialogOpen);
  const showDoneBadge = useStore((s) => s.settings.showDoneBadge ?? false);
  // Subscribe to paneStatus only while the done badge is on — status flips on
  // every terminal's running/idle/done transition and would re-render the whole
  // navigation for nothing otherwise.
  const paneStatus = useStore((s) => (s.settings.showDoneBadge ?? false) ? s.paneStatus : null);
  // Pane-id lists per workspace, recomputed only when layouts change (NOT on
  // every status flip — collectPaneIds walks every layout tree).
  const paneIdsByWs = useMemo(
    () => new Map(workspaces.map((w) => [w.id, collectPaneIds(w.layout)])),
    [workspaces]
  );

  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    position: 'before' | 'after';
  } | null>(null);

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
        const paneIds = paneIdsByWs.get(w.id) ?? [];
        const count = paneIds.length;
        // Remote-Workspaces zeigen ein Server-Icon statt des Farbpunkts sowie den
        // Servernamen als zweite Zeile (bzw. im title, wenn kein Platz dafür ist).
        const isRemote = w.kind === 'remote';
        const serverName = isRemote ? remoteServerName(servers, w.remote) : null;
        // Badge: number of "done" panes in INACTIVE workspaces (where you can't see them).
        const doneCount = !showDoneBadge || !paneStatus || w.id === activeId
          ? 0
          : paneIds.filter((pid) => paneStatus[pid] === 'done').length;
        return (
          <div
            key={w.id}
            className={[
              itemClass,
              isRemote ? 'remote' : '',
              w.id === activeId ? 'active' : '',
              w.id === draggedId ? 'dragging' : '',
              dropTarget?.id === w.id ? `drop-${dropTarget.position}` : ''
            ].filter(Boolean).join(' ')}
            title={isRemote
              ? (serverName
                  ? t('workspace.remoteTitle', { server: serverName })
                  : t('workspace.remoteTitleUnknown'))
              : undefined}
            draggable
            onClick={() => selectWorkspace(w.id)}
            onDoubleClick={(e) => { e.preventDefault(); setEditingId(w.id); }}
            onDragStart={(e) => {
              setDraggedId(w.id);
              setDropTarget(null);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', w.id);
            }}
            onDragOver={(e) => {
              if (!draggedId) return;
              if (draggedId === w.id) {
                setDropTarget(null);
                return;
              }
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const pointer = top ? e.clientX : e.clientY;
              const midpoint = top ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
              const position = pointer < midpoint ? 'before' : 'after';
              setDropTarget((current) => current?.id === w.id && current.position === position
                ? current
                : { id: w.id, position });
            }}
            onDrop={(e) => {
              e.preventDefault();
              const sourceId = draggedId || e.dataTransfer.getData('text/plain');
              if (sourceId && sourceId !== w.id) {
                const rect = e.currentTarget.getBoundingClientRect();
                const pointer = top ? e.clientX : e.clientY;
                const midpoint = top ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
                reorderWorkspace(sourceId, w.id, pointer < midpoint ? 'before' : 'after');
              }
              setDraggedId(null);
              setDropTarget(null);
            }}
            onDragEnd={() => {
              setDraggedId(null);
              setDropTarget(null);
            }}
          >
            {isRemote
              ? <span className="ws-remote-icon"><Icon name="server" size={13} /></span>
              : <span className="dot" style={w.color ? { background: w.color } : undefined} />}
            {isRemote && !top ? (
              <span className="ws-text">
                <span className="name">{w.name}</span>
                <span className={['ws-sub', serverName ? '' : 'missing'].filter(Boolean).join(' ')}>
                  {serverName ?? t('workspace.remoteServerRemoved')}
                </span>
              </span>
            ) : (
              <span className="name">{w.name}</span>
            )}
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
      {/* Nur sichtbar, wenn Server konfiguriert sind — ohne Remote-Setup bleibt
          die Navigation exakt wie bisher (auch für die bestehenden E2E-Specs). */}
      {hasServers && (
        <div
          className={top ? 'add-workspace-tab' : 'add-ws'}
          title={t('workspace.addRemoteWorkspace')}
          onClick={() => setRemoteDialogOpen(true)}
        >
          {top ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M3.6 9h16.8M3.6 15h16.8" />
              <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0 -18" />
            </svg>
          ) : t('workspace.addRemoteWorkspace')}
        </div>
      )}

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
          confirmLabel={t('workspace.closeConfirm')}
          onConfirm={() => { deleteWorkspace(pendingWs.id); setPendingDeleteId(null); }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
    </div>
  );
}
