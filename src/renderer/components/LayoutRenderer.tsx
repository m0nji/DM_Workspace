import React, { useRef } from 'react';
import type { LayoutNode } from '../../shared/types';
import { collectPaneIds } from '../../shared/layout-tree';
import { Splitter } from './Splitter';
import { Pane } from './Pane';

interface Props {
  node: LayoutNode;
  cwd: string;
  // When set, this pane is maximized: its siblings are kept mounted but hidden
  // (display:none) and the maximized pane's branch fills the whole area. Keeping
  // siblings mounted preserves their terminals (shell + scrollback) so restoring
  // is instant — no blank screen or Enter needed.
  maximizedPaneId?: string | null;
}

export function LayoutRenderer({ node, cwd, maximizedPaneId = null }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'pane') {
    return <Pane paneId={node.id} cwd={cwd} />;
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
        <LayoutRenderer node={node.children[0]} cwd={cwd} maximizedPaneId={maximizedPaneId} />
      </div>
      {!maximizingHere && (
        <Splitter splitId={node.id} direction={node.direction} containerRef={containerRef} />
      )}
      <div style={secondStyle} className="split-child">
        <LayoutRenderer node={node.children[1]} cwd={cwd} maximizedPaneId={maximizedPaneId} />
      </div>
    </div>
  );
}
