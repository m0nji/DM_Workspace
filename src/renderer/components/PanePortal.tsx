import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Pane } from './Pane';
import { acquirePaneHost, releasePaneHost } from '../pane-host';

interface Props { paneId: string; cwd: string; active?: boolean; }

// Renders a pane's content into its stable per-pane container (see
// pane-host.ts). WorkspaceView renders one PanePortal per pane in a FLAT,
// paneId-keyed list, so the pane's React identity — and therefore its terminal
// — survives any restructuring of the layout tree. LayoutRenderer only places
// lightweight slots that adopt the container at the right spot.
export function PanePortal({ paneId, cwd, active = true }: Props): React.ReactPortal {
  const host = acquirePaneHost(paneId);
  // Release only when the pane itself is gone (closed / workspace deleted),
  // never on layout reshuffles — those keep this component mounted.
  useEffect(() => () => releasePaneHost(paneId), [paneId]);
  return createPortal(<Pane paneId={paneId} cwd={cwd} active={active} />, host);
}
