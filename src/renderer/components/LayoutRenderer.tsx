import React, { useRef } from 'react';
import type { LayoutNode } from '../../shared/types';
import { Splitter } from './Splitter';
import { Pane } from './Pane';

interface Props { node: LayoutNode; cwd: string; }

export function LayoutRenderer({ node, cwd }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);

  if (node.type === 'pane') {
    return <Pane paneId={node.id} cwd={cwd} />;
  }

  const first = `${node.ratio * 100}%`;
  const second = `${(1 - node.ratio) * 100}%`;

  return (
    <div ref={containerRef} className={`split-container ${node.direction}`}>
      <div style={node.direction === 'h' ? { width: first } : { height: first }}
           className="split-child">
        <LayoutRenderer node={node.children[0]} cwd={cwd} />
      </div>
      <Splitter splitId={node.id} direction={node.direction} containerRef={containerRef} />
      <div style={node.direction === 'h' ? { width: second } : { height: second }}
           className="split-child">
        <LayoutRenderer node={node.children[1]} cwd={cwd} />
      </div>
    </div>
  );
}
