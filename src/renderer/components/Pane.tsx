import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  useStore, remotePaneCloseBlock, remotePaneCreateBlock, REMOTE_MAX_PANES,
  type RemoteBlockReason
} from '../store';
import { TerminalView } from './TerminalView';
import { SearchBar } from './SearchBar';
import { basename } from '../../shared/fs-path';
import { isRemotePaneKey } from '../../shared/remote-pane-key';

interface Props { paneId: string; cwd: string; active?: boolean; }

const svg = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

// Split into left + right (vertical divider).
function SplitLeftRight(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <line x1="8" y1="3" x2="8" y2="13" />
    </svg>
  );
}

// Split into top + bottom (horizontal divider).
function SplitTopBottom(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
    </svg>
  );
}

function Maximize(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <path d="M9 3h4v4" />
      <path d="M7 13H3V9" />
      <path d="M13 3l-4 4" />
      <path d="M3 13l4-4" />
    </svg>
  );
}

function Restore(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <path d="M12 4l-3 3" />
      <path d="M13 7h-4V3" />
      <path d="M4 12l3-3" />
      <path d="M3 9h4v4" />
    </svg>
  );
}

function Close(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

function Label(): React.JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <path d="M3 3.5h8.5A1.5 1.5 0 0 1 13 5v5a1.5 1.5 0 0 1-1.5 1.5H7L4 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5Z" />
      <line x1="4.5" y1="6.5" x2="10" y2="6.5" />
      <line x1="4.5" y1="8.8" x2="8.5" y2="8.8" />
    </svg>
  );
}

// Eigener MIME-Typ statt text/plain: eine aus dem Terminal gezogene
// Textauswahl traegt ihn nicht und kann deshalb keinen Tausch ausloesen.
const PANE_DRAG_TYPE = 'application/x-dm-pane';

export function Pane({ paneId, cwd, active = true }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const isRemote = isRemotePaneKey(paneId);
  const splitActivePane = useStore((s) => s.splitActivePane);
  const requestClosePane = useStore((s) => s.requestClosePane);
  const createRemotePane = useStore((s) => s.createRemotePane);
  // Warum ein Knopf deaktiviert ist, gehört in den Tooltip: „nicht verbunden",
  // „nur Lesezugriff", „Terminal-Grenze erreicht" und „letztes Terminal" sind
  // vier verschiedene Gründe und verdienen vier verschiedene Sätze.
  const createBlock = useStore((s) => (isRemote ? remotePaneCreateBlock(s.remote, paneId) : null));
  const closeBlock = useStore((s) => (isRemote ? remotePaneCloseBlock(s.remote, paneId) : null));
  // Aktion und Grund kombinieren statt ersetzen — sonst verschwindet aus dem
  // Tooltip, was der Knopf überhaupt täte.
  const withReason = (action: string, reason: RemoteBlockReason | null): string =>
    reason ? `${action} — ${t(`pane.remoteBlocked.${reason}`, { max: REMOTE_MAX_PANES })}` : action;
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const maximized = useStore((s) => s.maximizedPaneId === paneId);
  const status = useStore((s) => s.paneStatus[paneId] ?? 'idle');
  const focused = useStore((s) => s.focusedPaneId === paneId);
  const setFocusedPane = useStore((s) => s.setFocusedPane);
  const setPaneTitle = useStore((s) => s.setPaneTitle);
  // Keep the live folder visible and show the optional workspace-local pane
  // label beside it. Previously a template title replaced the folder entirely.
  const folder = useStore((s) => s.paneCwd[paneId] ?? cwd);
  const folderName = basename(folder) || folder;
  const manualLabel = useStore((s) =>
    s.workspaces.find((w) => w.paneTitles?.[paneId])?.paneTitles?.[paneId] ?? '');
  const autoLabel = useStore((s) => s.paneAutoTitles[paneId] ?? '');
  const label = manualLabel || autoLabel;
  const automatic = !manualLabel && !!autoLabel;
  const [editingLabel, setEditingLabel] = React.useState(false);
  const [labelDraft, setLabelDraft] = React.useState(manualLabel);
  const labelInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const swapPanesInLayout = useStore((s) => s.swapPanesInLayout);

  React.useEffect(() => {
    if (!editingLabel) return;
    setLabelDraft(manualLabel);
    labelInputRef.current?.focus();
    labelInputRef.current?.select();
  }, [editingLabel, manualLabel]);

  // Absicherung gegen haengenbleibende Hervorhebung: bricht der Nutzer den
  // Drag per Escape ueber einem FREMDEN Pane ab, feuert dort weder dragleave
  // noch drop -- dessen lokaler dragOver-Zustand wuerde sonst nie zurueckgesetzt.
  // dragend feuert dagegen immer auf der Quelle und bubbelt bis window, egal wo
  // der Zeiger steht und ob abgebrochen wurde. Der Listener laeuft nur, solange
  // dieses Pane ueberhaupt hervorgehoben ist -- kein Dauer-Listener pro Pane.
  React.useEffect(() => {
    if (!dragOver) return;
    const onDragEndAnywhere = (): void => setDragOver(false);
    window.addEventListener('dragend', onDragEndAnywhere);
    return () => window.removeEventListener('dragend', onDragEndAnywhere);
  }, [dragOver]);

  const saveLabel = (): void => {
    setPaneTitle(paneId, labelDraft);
    setEditingLabel(false);
  };

  return (
    <div
      className={`pane ${focused ? 'focused' : ''} ${dragOver ? 'drop-target' : ''}`}
      onMouseDownCapture={() => setFocusedPane(paneId)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANE_DRAG_TYPE)) return;
        // Ohne preventDefault lehnt der Browser den Drop ab.
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        // Nur raeumen, wenn der Zeiger das Pane wirklich verlaesst -- beim
        // Wechsel zwischen Kindelementen feuert dragleave ebenfalls.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        const sourceId = e.dataTransfer.getData(PANE_DRAG_TYPE);
        setDragOver(false);
        if (!sourceId || sourceId === paneId) return;
        e.preventDefault();
        swapPanesInLayout(sourceId, paneId);
      }}
    >
      <div
        className="pane-header"
        draggable={!editingLabel}
        onDragStart={(e) => {
          e.dataTransfer.setData(PANE_DRAG_TYPE, paneId);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={() => setDragOver(false)}
      >
        <span className={`status-dot ${status}`} title={t(`pane.status.${status}`)} />
        <div className={`pane-heading ${label ? 'has-label' : ''}`}>
          <span className="pane-title pane-title-full" title={folder}>{folder}</span>
          <span className="pane-title pane-title-short" title={folder}>{folderName}</span>
          {editingLabel ? (
            <input
              ref={labelInputRef}
              className="pane-label-input"
              value={labelDraft}
              maxLength={120}
              aria-label={t('pane.label')}
              placeholder={automatic ? autoLabel : t('pane.labelPlaceholder')}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={saveLabel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setLabelDraft(manualLabel);
                  setEditingLabel(false);
                }
              }}
            />
          ) : label ? (
            <>
              <span className="pane-label-divider" aria-hidden="true">·</span>
              <span
                className={`pane-label ${automatic ? 'automatic' : ''}`}
                title={automatic ? `${t('pane.automaticLabel')}: ${label}` : label}
              >{label}</span>
            </>
          ) : null}
        </div>
        <button
          className={`pane-btn pane-label-btn ${manualLabel ? 'active' : ''}`}
          title={t(manualLabel ? 'pane.editLabel' : automatic ? 'pane.overrideLabel' : 'pane.addLabel')}
          aria-label={t(manualLabel ? 'pane.editLabel' : automatic ? 'pane.overrideLabel' : 'pane.addLabel')}
          onClick={() => setEditingLabel(true)}
        ><Label /></button>
        {/* Lokal: Splitten. Remote: ein neues Terminal IM PROJEKT — ein Split
            würde eine lokale Shell in den Remote-Workspace mischen. Die Wahl
            der Seite gibt es trotzdem auf beiden Wegen: remote entscheidet sie,
            wo die vom Server gemeldete Pane im lokalen Layout landet. */}
        {isRemote ? (
          <>
            <button
              className="pane-btn"
              disabled={!!createBlock}
              title={withReason(t('pane.newRemoteTerminalRight'), createBlock)}
              onClick={() => createRemotePane(paneId, 'h')}
            ><SplitLeftRight /></button>
            <button
              className="pane-btn"
              disabled={!!createBlock}
              title={withReason(t('pane.newRemoteTerminalBelow'), createBlock)}
              onClick={() => createRemotePane(paneId, 'v')}
            ><SplitTopBottom /></button>
          </>
        ) : (
          <>
            <button className="pane-btn" title={t('pane.splitHorizontal')}
                    onClick={() => splitActivePane(paneId, 'h')}><SplitLeftRight /></button>
            <button className="pane-btn" title={t('pane.splitVertical')}
                    onClick={() => splitActivePane(paneId, 'v')}><SplitTopBottom /></button>
          </>
        )}
        <button className="pane-btn" title={maximized ? t('pane.restore') : t('pane.maximize')}
                onClick={() => toggleMaximize(paneId)}>{maximized ? <Restore /> : <Maximize />}</button>
        <button
          className="pane-btn"
          disabled={!!closeBlock}
          title={withReason(t('common.close'), closeBlock)}
          onClick={() => requestClosePane(paneId)}
        ><Close /></button>
      </div>
      <div className="pane-body">
        <SearchBar paneId={paneId} />
        <TerminalView paneId={paneId} cwd={cwd} active={active} />
      </div>
    </div>
  );
}
