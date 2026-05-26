import React from 'react';
import { useStore } from '../store';
import { WelcomeScreen } from './WelcomeScreen';
import { LayoutRenderer } from './LayoutRenderer';

// Every workspace stays mounted; only the active one is visible. This keeps each
// terminal's xterm instance (and its scrollback) alive across workspace switches,
// so switching back is instant instead of showing a blank, re-spawned terminal.
export function WorkspaceView(): JSX.Element {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const maximizedPaneId = useStore((s) => s.maximizedPaneId);

  return (
    <div className="workspace-view">
      {workspaces.map((ws) => {
        const active = ws.id === activeId;
        let content: JSX.Element;
        if (!ws.layout) {
          content = <WelcomeScreen workspaceId={ws.id} cwd={ws.cwd} />;
        } else {
          content = (
            <LayoutRenderer
              node={ws.layout}
              cwd={ws.cwd}
              maximizedPaneId={active ? maximizedPaneId : null}
            />
          );
        }
        return (
          <div key={ws.id} className="ws-host" style={{ display: active ? 'block' : 'none' }}>
            {content}
          </div>
        );
      })}
    </div>
  );
}
