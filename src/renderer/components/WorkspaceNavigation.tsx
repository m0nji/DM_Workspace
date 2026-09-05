import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import type {
  ServerConfig, Workspace, WorkspaceGroup, WorkspaceNavigationPlacement
} from '../../shared/types';
import { BUSY_INDICATOR_SPEED_DEFAULT_MS } from '../../shared/types';
import { workspaceRunning } from '../../shared/pane-busy';
import { resolveTabDropIntent, type TabDropIntent } from '../../shared/tab-drop-intent';
import { applyTabDrop, type DropTarget } from '../../shared/workspace-groups';
import { ContextMenu, type MenuItem } from './ContextMenu';
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
// (`workspaceGroups` braucht das nicht: der Store hält dort immer ein echtes
// Array, ein `?? []` wäre hier genau der Fehler, den NO_SERVERS verhindert.)
const NO_SERVERS: ServerConfig[] = [];

// Nur für die Vorschau unten: applyTabDrop legt bei einem `into` auf ein
// gruppenloses Register eine Gruppe an, und die Vorschau will wissen, DASS das
// passieren würde — angelegt wird dabei nichts, das Ergebnis wird verworfen.
const PREVIEW_GROUP = '__preview__';

interface DropState {
  target: DropTarget;
  intent: TabDropIntent;
  x: number;
  y: number;
}

/** Ein Lauf der Navigation: entweder eine Gruppe mit ihren Mitgliedern, oder lose Register. */
interface Run {
  group: WorkspaceGroup | null;
  items: Workspace[];
}

export function WorkspaceNavigation({ placement }: WorkspaceNavigationProps): React.JSX.Element {
  const { t } = useTranslation();
  const workspaces = useStore((s) => s.workspaces);
  const workspaceGroups = useStore((s) => s.workspaceGroups);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const selectWorkspace = useStore((s) => s.selectWorkspace);
  const addWorkspace = useStore((s) => s.addWorkspace);
  const dropWorkspaceTab = useStore((s) => s.dropWorkspaceTab);
  const renameWorkspaceGroup = useStore((s) => s.renameWorkspaceGroup);
  const setWorkspaceGroupCollapsed = useStore((s) => s.setWorkspaceGroupCollapsed);
  const dissolveWorkspaceGroup = useStore((s) => s.dissolveWorkspaceGroup);
  // Der Palettenbefehl kann den Inline-Editor nicht selbst oeffnen — er lebt in
  // dieser Komponente. Er setzt deshalb ein Store-Feld, das hier gelesen wird;
  // dasselbe Muster wie searchOpenPaneId. Fluechtig, nicht persistiert.
  const renamingGroupId = useStore((s) => s.renamingGroupId);
  const setRenamingGroup = useStore((s) => s.setRenamingGroup);
  const deleteWorkspace = useStore((s) => s.deleteWorkspace);
  const servers = useStore((s) => s.settings.servers ?? NO_SERVERS);
  const hasServers = servers.length > 0;
  const setRemoteDialogOpen = useStore((s) => s.setRemoteWorkspaceDialogOpen);
  const showDoneBadge = useStore((s) => s.settings.showDoneBadge ?? false);
  const busyIndicator = useStore((s) => s.settings.busyIndicator ?? 'off');
  const busyColor = useStore((s) => s.settings.busyIndicatorColor);
  const busySpeedMs = useStore((s) => s.settings.busyIndicatorSpeedMs ?? BUSY_INDICATOR_SPEED_DEFAULT_MS);
  const busyOn = busyIndicator !== 'off';
  // Subscribe to paneStatus only while something displays it — status flips on
  // every terminal's running/idle/done transition and would re-render the whole
  // navigation for nothing otherwise. Two displays need it now: the done badge,
  // and the busy indicator's fallback for panes that send no prompt marker.
  const paneStatus = useStore((s) =>
    (s.settings.showDoneBadge ?? false) || (s.settings.busyIndicator ?? 'off') !== 'off'
      ? s.paneStatus
      : null);
  // paneShell kippt seltener — setPaneShell gibt bei unveränderter Meldung
  // denselben Zustand zurück —, aber ohne Indikator wird es gar nicht gebraucht.
  const paneShell = useStore((s) => (s.settings.busyIndicator ?? 'off') !== 'off' ? s.paneShell : null);
  // Pane-id lists per workspace, recomputed only when layouts change (NOT on
  // every status flip — collectPaneIds walks every layout tree).
  const paneIdsByWs = useMemo(
    () => new Map(workspaces.map((w) => [w.id, collectPaneIds(w.layout)])),
    [workspaces]
  );

  // Die Rangfolge der beiden Quellen steckt in workspaceRunning — hier wird sie
  // nicht nachgebaut, nur abgefragt.
  const runningIn = (paneIds: readonly string[]): boolean =>
    !!paneShell && workspaceRunning(paneIds, paneShell, paneStatus ?? {});

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showChangelog, setShowChangelog] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ groupId: string; x: number; y: number } | null>(null);

  const endDrag = (): void => { setDraggedId(null); setDrop(null); };

  // Bricht der Nutzer mit Escape über einem FREMDEN Element ab, feuert dort
  // weder dragleave noch drop — ohne diesen Listener bliebe die Hervorhebung
  // hängen. Derselbe Fall ist beim Pane-Drag schon einmal aufgetreten.
  useEffect(() => {
    if (!draggedId) return;
    const clear = (): void => endDrag();
    window.addEventListener('dragend', clear);
    return () => window.removeEventListener('dragend', clear);
  }, [draggedId]);

  const top = placement === 'top';
  const rootClass = top ? 'workspace-tabs' : 'sidebar';
  const itemClass = top ? 'workspace-tab' : 'ws-item';

  const pendingWs = pendingDeleteId ? workspaces.find((w) => w.id === pendingDeleteId) : undefined;

  // Aufeinanderfolgende Register mit derselben groupId bilden einen Lauf. Dass
  // sie überhaupt aufeinanderfolgen, garantiert normalizeGroups im Store — die
  // Navigation muss dafür nichts sortieren.
  const runs = useMemo<Run[]>(() => {
    const out: Run[] = [];
    for (const w of workspaces) {
      const last = out[out.length - 1];
      if (w.groupId && last?.group?.id === w.groupId) { last.items.push(w); continue; }
      const group = w.groupId ? workspaceGroups.find((g) => g.id === w.groupId) ?? null : null;
      out.push({ group, items: [w] });
    }
    return out;
  }, [workspaces, workspaceGroups]);

  // Was der Drop bedeuten WÜRDE — nicht nachgebaut, sondern aus applyTabDrop
  // selbst abgeleitet. Damit kann der Hinweis nicht behaupten, was dann doch
  // nicht passiert; die Regel für die Ränder eines Laufs steht nur an einer
  // Stelle. Läuft nur während eines Drags und über eine Handvoll Register.
  const hint = useMemo<string | null>(() => {
    if (!draggedId || !drop) return null;
    const unnamed = t('workspace.group.unnamed');
    const before = { workspaces, groups: workspaceGroups };
    const dragged = workspaces.find((w) => w.id === draggedId);
    if (!dragged) return null;
    const after = applyTabDrop(before, draggedId, drop.target, drop.intent, () => PREVIEW_GROUP);
    const next = after.workspaces.find((w) => w.id === draggedId);
    if (!next || next.groupId === dragged.groupId) return null;
    if (next.groupId === undefined) {
      const old = workspaceGroups.find((g) => g.id === dragged.groupId);
      return old ? t('workspace.group.hintLeave', { name: old.name || unnamed }) : null;
    }
    if (next.groupId === PREVIEW_GROUP) {
      const partner = drop.target.kind === 'workspace'
        ? workspaces.find((w) => w.id === drop.target.id)
        : undefined;
      return partner ? t('workspace.group.hintGroupWith', { name: partner.name }) : null;
    }
    const joined = after.groups.find((g) => g.id === next.groupId);
    return joined ? t('workspace.group.hintJoin', { name: joined.name || unnamed }) : null;
  }, [draggedId, drop, workspaces, workspaceGroups, t]);

  const isDropTarget = (kind: DropTarget['kind'], id: string, intent: TabDropIntent): boolean =>
    drop?.target.kind === kind && drop.target.id === id && drop.intent === intent;

  // Ein neu entstandener Gruppen-Chip geht sofort in die Bearbeitung: die Gruppe
  // wird namenlos angelegt, und der Moment, sie zu benennen, ist genau jetzt.
  const runDrop = (sourceId: string, target: DropTarget, intent: TabDropIntent): void => {
    const known = new Set(useStore.getState().workspaceGroups.map((g) => g.id));
    dropWorkspaceTab(sourceId, target, intent);
    const created = useStore.getState().workspaceGroups.find((g) => !known.has(g.id));
    if (created) setEditingGroupId(created.id);
  };

  const dragOverHandlers = (target: DropTarget, forceIntent?: TabDropIntent) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!draggedId) return;
      // Selbst-Drop OHNE preventDefault verwerfen — dann zeigt Chromium von
      // sich aus den "nicht ablegen"-Cursor.
      if (target.kind === 'workspace' && draggedId === target.id) { setDrop(null); return; }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const rect = e.currentTarget.getBoundingClientRect();
      const intent = forceIntent ?? resolveTabDropIntent(
        top ? e.clientX : e.clientY,
        top ? rect.left : rect.top,
        top ? rect.width : rect.height
      );
      setDrop((current) =>
        current
        && current.target.kind === target.kind
        && current.target.id === target.id
        && current.intent === intent
        && current.x === e.clientX
        && current.y === e.clientY
          ? current
          : { target, intent, x: e.clientX, y: e.clientY }
      );
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const sourceId = draggedId || e.dataTransfer.getData('text/plain');
      const intent = drop?.intent ?? 'before';
      if (sourceId && !(target.kind === 'workspace' && sourceId === target.id)) {
        runDrop(sourceId, target, intent);
      }
      endDrag();
    },
    onDragEnd: endDrag
  });

  const renderItem = (w: Workspace): React.JSX.Element => {
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
    // Auch das aktive Register: die Asymmetrie des Fertig-Badges waere hier
    // verwirrend ("warum dreht sich meins nie?").
    const running = runningIn(paneIds);
    const target: DropTarget = { kind: 'workspace', id: w.id };
    return (
      <div
        key={w.id}
        className={[
          itemClass,
          isRemote ? 'remote' : '',
          w.id === activeId ? 'active' : '',
          w.id === draggedId ? 'dragging' : '',
          isDropTarget('workspace', w.id, 'before') ? 'drop-before' : '',
          isDropTarget('workspace', w.id, 'after') ? 'drop-after' : '',
          isDropTarget('workspace', w.id, 'into') ? 'drop-into' : ''
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
          setDrop(null);
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', w.id);
        }}
        {...dragOverHandlers(target)}
      >
        {isRemote
          ? <span className={['ws-remote-icon', running ? 'running' : ''].filter(Boolean).join(' ')}>
              <Icon name="server" size={13} />
            </span>
          : <span
              className={['dot', running ? 'running' : ''].filter(Boolean).join(' ')}
              style={w.color ? { background: w.color } : undefined}
            />}
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
  };

  const renderChip = (g: WorkspaceGroup, items: Workspace[]): React.JSX.Element => {
    const collapsed = g.collapsed ?? false;
    // Eine eingeklappte Gruppe, die den aktiven Workspace enthält, muss zeigen,
    // dass man dort steht — sonst wäre activeWorkspaceId gültig, aber unsichtbar.
    const activeMember = collapsed ? items.find((w) => w.id === activeId) : undefined;
    const editing = editingGroupId === g.id || renamingGroupId === g.id;
    // Sonst versteckt eine eingeklappte Gruppe genau die Information, wegen der
    // man den Indikator eingeschaltet hat — und eingeklappt wird gerade dann,
    // wenn viel parallel laeuft.
    const groupRunning = runningIn(items.flatMap((w) => paneIdsByWs.get(w.id) ?? []));
    // Beide Quellen raeumen, sonst rissen ein stehengebliebener Store-Wert oder
    // der lokale Zustand den Editor beim naechsten Rendern wieder auf.
    const stopEditing = (): void => { setEditingGroupId(null); setRenamingGroup(null); };
    return (
      <div
        className={[
          'ws-group-chip',
          activeMember ? 'active' : '',
          groupRunning ? 'running' : '',
          isDropTarget('group', g.id, 'into') ? 'drop-into' : ''
        ].filter(Boolean).join(' ')}
        title={collapsed ? t('tooltip.expandGroup') : t('tooltip.collapseGroup')}
        onClick={() => { if (!editing) setWorkspaceGroupCollapsed(g.id, !collapsed); }}
        onDoubleClick={(e) => { e.preventDefault(); setEditingGroupId(g.id); }}
        // Auflösen und Umbenennen liegen im Kontextmenü, nicht als Knopf auf dem
        // Chip. Ein Knopf hätte im Klickpfad des Einklappens gelegen: er
        // erscheint erst beim Überfahren, also genau dann, wenn der Zeiger schon
        // dort ist — ein Fehlklick hätte die Gruppe aufgelöst. (Der e2e-Test hat
        // genau das getan, bevor es ein Kontextmenü gab.)
        onContextMenu={(e) => { e.preventDefault(); setGroupMenu({ groupId: g.id, x: e.clientX, y: e.clientY }); }}
        // Der Chip nimmt jeden Drop als "ans Ende dieser Gruppe" — ihn in
        // Drittel zu teilen hiesse, zwei Bedeutungen auf wenige Pixel zu legen.
        {...dragOverHandlers({ kind: 'group', id: g.id }, 'into')}
      >
        <span className={['ws-group-disclosure', collapsed ? 'collapsed' : ''].filter(Boolean).join(' ')} aria-hidden="true">
          <Icon name="chevron-down" size={12} />
        </span>
        {editing ? (
          <input
            className="ws-group-input"
            autoFocus
            defaultValue={g.name}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { renameWorkspaceGroup(g.id, e.target.value.trim()); stopEditing(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') stopEditing();
            }}
          />
        ) : (
          <span className="ws-group-name" data-placeholder={t('workspace.group.unnamed')}>{g.name}</span>
        )}
        <span className="ws-group-count">{activeMember ? activeMember.name : items.length}</span>
      </div>
    );
  };

  return (
    <div
      className={rootClass}
      // Art, Farbe und Tempo einmal an der Wurzel statt an jedem Punkt; die
      // Werte sind in migrateSettings bereits geprueft und geklemmt.
      {...(busyOn ? { 'data-busy': busyIndicator } : {})}
      style={busyOn
        ? ({
            '--busy-color': busyColor ?? 'var(--accent)',
            '--busy-speed': `${busySpeedMs}ms`
          } as React.CSSProperties)
        : undefined}
    >
      {!top && <div className="sidebar-header"><span>{t('workspace.sectionTitle')}</span></div>}
      {runs.map((run) => (
        run.group
          ? (
            <div
              key={`g-${run.group.id}`}
              className="ws-group"
              style={run.group.color
                ? ({ ['--ws-group-color' as string]: run.group.color } as React.CSSProperties)
                : undefined}
            >
              {renderChip(run.group, run.items)}
              {!(run.group.collapsed ?? false) && run.items.map(renderItem)}
            </div>
          )
          : <React.Fragment key={`w-${run.items[0].id}`}>{run.items.map(renderItem)}</React.Fragment>
      ))}
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

      {/* Am body statt in der Leiste: .workspace-tabs ist 42px hoch und trägt
          overflow-y: hidden, ein Kind würde abgeschnitten. */}
      {hint && drop && createPortal(
        <div className="ws-drop-hint" style={{ left: Math.min(drop.x + 14, window.innerWidth - 340), top: drop.y + 18 }}>
          {hint}
        </div>,
        document.body
      )}

      {groupMenu && (
        <ContextMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={[
            { label: t('workspace.group.rename'), onClick: () => setEditingGroupId(groupMenu.groupId) },
            { label: t('tooltip.dissolveGroup'), onClick: () => dissolveWorkspaceGroup(groupMenu.groupId) }
          ] as MenuItem[]}
          onClose={() => setGroupMenu(null)}
        />
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
          tone="danger"
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
