import React from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';
import { SearchBar } from './SearchBar';

interface Props { paneId: string; cwd: string; }

const svg = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
};

// Split into left + right (vertical divider).
function SplitLeftRight(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <line x1="8" y1="3" x2="8" y2="13" />
    </svg>
  );
}

// Split into top + bottom (horizontal divider).
function SplitTopBottom(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
      <line x1="2.5" y1="8" x2="13.5" y2="8" />
    </svg>
  );
}

function Maximize(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <path d="M9 3h4v4" />
      <path d="M7 13H3V9" />
      <path d="M13 3l-4 4" />
      <path d="M3 13l4-4" />
    </svg>
  );
}

function Restore(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <path d="M12 4l-3 3" />
      <path d="M13 7h-4V3" />
      <path d="M4 12l3-3" />
      <path d="M3 9h4v4" />
    </svg>
  );
}

function Close(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" {...svg}>
      <line x1="4" y1="4" x2="12" y2="12" />
      <line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  );
}

export function Pane({ paneId, cwd }: Props): JSX.Element {
  const splitActivePane = useStore((s) => s.splitActivePane);
  const closeActivePane = useStore((s) => s.closeActivePane);
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const maximized = useStore((s) => s.maximizedPaneId === paneId);
  const status = useStore((s) => s.paneStatus[paneId] ?? 'idle');
  const focused = useStore((s) => s.focusedPaneId === paneId);
  const setFocusedPane = useStore((s) => s.setFocusedPane);

  return (
    <div
      className={`pane ${focused ? 'focused' : ''}`}
      onMouseDownCapture={() => setFocusedPane(paneId)}
    >
      <div className="pane-header">
        <span className={`status-dot ${status}`} title={status} />
        <span className="pane-title">{cwd}</span>
        <button className="pane-btn" title="Split into left & right"
                onClick={() => splitActivePane(paneId, 'h')}><SplitLeftRight /></button>
        <button className="pane-btn" title="Split into top & bottom"
                onClick={() => splitActivePane(paneId, 'v')}><SplitTopBottom /></button>
        <button className="pane-btn" title={maximized ? 'Restore' : 'Maximize'}
                onClick={() => toggleMaximize(paneId)}>{maximized ? <Restore /> : <Maximize />}</button>
        <button className="pane-btn" title="Close"
                onClick={() => closeActivePane(paneId)}><Close /></button>
      </div>
      <div className="pane-body">
        <SearchBar paneId={paneId} />
        <TerminalView paneId={paneId} cwd={cwd} />
      </div>
    </div>
  );
}
