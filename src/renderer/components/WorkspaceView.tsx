import React from 'react';
import { useStore } from '../store';
import { collectPaneIds } from '../../shared/layout-tree';
import { WelcomeScreen } from './WelcomeScreen';
import { LayoutRenderer } from './LayoutRenderer';
import { PanePortal } from './PanePortal';

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
          // The layout tree renders only geometry (splits + per-pane slots).
          // Pane CONTENT mounts here, in a flat paneId-keyed portal list, so a
          // terminal's React identity survives any layout restructuring — a
          // remount would replay saved scrollback beneath the live program and
          // shred the pane (see pane-host.ts).
          content = (
            <>
              <LayoutRenderer
                node={ws.layout}
                maximizedPaneId={active ? maximizedPaneId : null}
              />
              {collectPaneIds(ws.layout).map((paneId) => (
                <PanePortal key={paneId} paneId={paneId} cwd={ws.cwd} active={active} />
              ))}
            </>
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
