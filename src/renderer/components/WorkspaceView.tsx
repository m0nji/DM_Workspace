import React from 'react';
import { useStore } from '../store';
import { WelcomeScreen } from './WelcomeScreen';
import { LayoutRenderer } from './LayoutRenderer';

// Every workspace stays mounted; only the active one is visible. This keeps each
// terminal's xterm instance (and its scrollback) alive across workspace switches,
// so switching back is instant instead of showing a blank, re-spawned terminal.
//
// `active` is threaded down to each TerminalView so only the visible workspace's
// panes hold a WebGL/GPU context. Electron caps live WebGL contexts (~16); one
// per mounted-but-hidden pane would exhaust them. Inactive panes drop the context
// (xterm buffer stays in memory, DOM renderer covers them) and reacquire it on
// return — see TerminalView's syncWebgl.
export function WorkspaceView(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces);
  const activeId = useStore((s) => s.activeWorkspaceId);
  const maximizedPaneId = useStore((s) => s.maximizedPaneId);

  return (
    <div className="workspace-view">
      {workspaces.map((ws) => {
        const active = ws.id === activeId;
        let content: React.JSX.Element;
        if (!ws.layout) {
          content = <WelcomeScreen workspaceId={ws.id} cwd={ws.cwd} />;
        } else {
          content = (
            <LayoutRenderer
              node={ws.layout}
              cwd={ws.cwd}
              active={active}
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
