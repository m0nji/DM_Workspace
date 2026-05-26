import React from 'react';
import { useStore } from '../store';
import { TerminalView } from './TerminalView';

interface Props { paneId: string; cwd: string; }

export function Pane({ paneId, cwd }: Props): JSX.Element {
  const splitActivePane = useStore((s) => s.splitActivePane);
  const closeActivePane = useStore((s) => s.closeActivePane);
  const toggleMaximize = useStore((s) => s.toggleMaximize);
  const maximized = useStore((s) => s.maximizedPaneId === paneId);

  return (
    <div className="pane">
      <div className="pane-header">
        <span className="pane-title">{cwd}</span>
        <button className="pane-btn" title="Split right (left/right)"
                onClick={() => splitActivePane(paneId, 'h')}>▥</button>
        <button className="pane-btn" title="Split down (top/bottom)"
                onClick={() => splitActivePane(paneId, 'v')}>▤</button>
        <button className="pane-btn" title={maximized ? 'Restore' : 'Maximize'}
                onClick={() => toggleMaximize(paneId)}>{maximized ? '🗗' : '⤢'}</button>
        <button className="pane-btn" title="Close"
                onClick={() => closeActivePane(paneId)}>✕</button>
      </div>
      <div className="pane-body">
        <TerminalView paneId={paneId} cwd={cwd} />
      </div>
    </div>
  );
}
