import React, { useLayoutEffect, useRef } from 'react';
import type { LayoutNode } from '../../shared/types';
import { collectPaneIds } from '../../shared/layout-tree';
import { Splitter } from './Splitter';
import { acquirePaneHost } from '../pane-host';

interface Props {
  node: LayoutNode;
  // When set, this pane is maximized: its siblings are kept mounted but hidden
  // (display:none) and the maximized pane's branch fills the whole area. Keeping
  // siblings mounted preserves their terminals (shell + scrollback) so restoring
  // is instant — no blank screen or Enter needed.
  maximizedPaneId?: string | null;
}

// Adopts the pane's stable container (see pane-host.ts) at this layout
// position. The slot itself is freely re-created whenever the tree shape
// changes; appendChild MOVES the already-populated container, so the pane's
// terminal never remounts. The actual pane content is rendered into that
// container by WorkspaceView's flat PanePortal list.
function PaneSlot({ paneId }: { paneId: string }): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  // Layout effect: the container must be in place before paint, or the pane
  // would flash empty for a frame on every split/close.
  useLayoutEffect(() => {
    ref.current!.appendChild(acquirePaneHost(paneId));
  }, [paneId]);
  return <div ref={ref} className="pane-slot" />;
}

export function LayoutRenderer({ node, maximizedPaneId = null }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'pane') {
    return <PaneSlot paneId={node.id} />;
  }

  const horizontal = node.direction === 'h';
  const inChild0 = maximizedPaneId != null && collectPaneIds(node.children[0]).includes(maximizedPaneId);
  const inChild1 = maximizedPaneId != null && collectPaneIds(node.children[1]).includes(maximizedPaneId);
  const maximizingHere = inChild0 || inChild1;

  // Default: split by ratio along the node's axis.
  const firstSize = `${node.ratio * 100}%`;
  const secondSize = `${(1 - node.ratio) * 100}%`;
  let firstStyle: React.CSSProperties = horizontal ? { width: firstSize } : { height: firstSize };
  let secondStyle: React.CSSProperties = horizontal ? { width: secondSize } : { height: secondSize };

  if (maximizingHere) {
    // Give the branch containing the maximized pane the full area; hide the other
    // (still mounted, so its terminal survives).
    firstStyle = inChild0
      ? (horizontal ? { width: '100%' } : { height: '100%' })
      : { display: 'none' };
    secondStyle = inChild1
      ? (horizontal ? { width: '100%' } : { height: '100%' })
      : { display: 'none' };
  }

  return (
    <div ref={containerRef} className={`split-container ${node.direction}`}>
      <div style={firstStyle} className="split-child">
        <LayoutRenderer node={node.children[0]} maximizedPaneId={maximizedPaneId} />
      </div>
      {!maximizingHere && (
        <Splitter splitId={node.id} direction={node.direction} containerRef={containerRef} />
      )}
      <div style={secondStyle} className="split-child">
        <LayoutRenderer node={node.children[1]} maximizedPaneId={maximizedPaneId} />
      </div>
    </div>
  );
}
