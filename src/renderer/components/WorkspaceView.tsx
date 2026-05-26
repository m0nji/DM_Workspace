import React from 'react';
import { useStore } from '../store';
import { WelcomeScreen } from './WelcomeScreen';
import { LayoutRenderer } from './LayoutRenderer';
import { Pane } from './Pane';

export function WorkspaceView(): JSX.Element {
  const ws = useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const maximizedPaneId = useStore((s) => s.maximizedPaneId);

  if (!ws) return <div className="workspace-view" />;
  if (!ws.layout) {
    return <div className="workspace-view"><WelcomeScreen /></div>;
  }

  if (maximizedPaneId) {
    return (
      <div className="workspace-view">
        <div className="maximized-host">
          <Pane paneId={maximizedPaneId} cwd={ws.cwd} />
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-view">
      <LayoutRenderer node={ws.layout} cwd={ws.cwd} />
    </div>
  );
}
