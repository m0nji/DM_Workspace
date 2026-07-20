import React from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { SearchBar } from './SearchBar';

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

export function Pane({ paneId, cwd, active = true }: Props): React.JSX.Element {
  const { t } = useTranslation();
  const splitActivePane = useStore((s) => s.splitActivePane);
  const requestClosePane = useStore((s) => s.requestClosePane);
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const maximized = useStore((s) => s.maximizedPaneId === paneId);
  const status = useStore((s) => s.paneStatus[paneId] ?? 'idle');
  const focused = useStore((s) => s.focusedPaneId === paneId);
  const setFocusedPane = useStore((s) => s.setFocusedPane);
  const setPaneTitle = useStore((s) => s.setPaneTitle);
  // Keep the live folder visible and show the optional workspace-local pane
  // label beside it. Previously a template title replaced the folder entirely.
  const folder = useStore((s) => s.paneCwd[paneId] ?? cwd);
  const label = useStore((s) =>
    s.workspaces.find((w) => w.paneTitles?.[paneId])?.paneTitles?.[paneId] ?? '');
  const [editingLabel, setEditingLabel] = React.useState(false);
  const [labelDraft, setLabelDraft] = React.useState(label);
  const labelInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!editingLabel) return;
    setLabelDraft(label);
    labelInputRef.current?.focus();
    labelInputRef.current?.select();
  }, [editingLabel, label]);

  const saveLabel = (): void => {
    setPaneTitle(paneId, labelDraft);
    setEditingLabel(false);
  };

  return (
    <div
      className={`pane ${focused ? 'focused' : ''}`}
      onMouseDownCapture={() => setFocusedPane(paneId)}
    >
      <div className="pane-header">
        <span className={`status-dot ${status}`} title={t(`pane.status.${status}`)} />
        <div className="pane-heading">
          <span className="pane-title" title={folder}>{folder}</span>
          {editingLabel ? (
            <input
              ref={labelInputRef}
              className="pane-label-input"
              value={labelDraft}
              maxLength={120}
              aria-label={t('pane.label')}
              placeholder={t('pane.labelPlaceholder')}
              onChange={(event) => setLabelDraft(event.target.value)}
              onBlur={saveLabel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  event.currentTarget.blur();
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  setLabelDraft(label);
                  setEditingLabel(false);
                }
              }}
            />
          ) : label ? (
            <>
              <span className="pane-label-divider" aria-hidden="true">·</span>
              <span className="pane-label" title={label}>{label}</span>
            </>
          ) : null}
        </div>
        <button
          className={`pane-btn pane-label-btn ${label ? 'active' : ''}`}
          title={t(label ? 'pane.editLabel' : 'pane.addLabel')}
          aria-label={t(label ? 'pane.editLabel' : 'pane.addLabel')}
          onClick={() => setEditingLabel(true)}
        ><Label /></button>
        <button className="pane-btn" title={t('pane.splitHorizontal')}
                onClick={() => splitActivePane(paneId, 'h')}><SplitLeftRight /></button>
        <button className="pane-btn" title={t('pane.splitVertical')}
                onClick={() => splitActivePane(paneId, 'v')}><SplitTopBottom /></button>
        <button className="pane-btn" title={maximized ? t('pane.restore') : t('pane.maximize')}
                onClick={() => toggleMaximize(paneId)}>{maximized ? <Restore /> : <Maximize />}</button>
        <button className="pane-btn" title={t('common.close')}
                onClick={() => requestClosePane(paneId)}><Close /></button>
      </div>
      <div className="pane-body">
        <SearchBar paneId={paneId} />
        <TerminalView paneId={paneId} cwd={cwd} active={active} />
      </div>
    </div>
  );
}
