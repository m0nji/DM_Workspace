import React, { useCallback } from 'react';
import { useStore } from '../store';
import { beginDragGuard } from '../drag-guard';
import { createSplitDrag } from '../split-drag';
import type { Direction } from '../../shared/types';

interface Props { splitId: string; direction: Direction; containerRef: React.RefObject<HTMLDivElement | null>; }

export function Splitter({ splitId, direction, containerRef }: Props): React.JSX.Element {
  const resizeSplit = useStore((s) => s.resizeSplit);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const endGuard = beginDragGuard();
    const drag = createSplitDrag((ratio, persist) => resizeSplit(splitId, ratio, persist));

    const onMove = (ev: MouseEvent) => {
      drag.move(direction === 'h'
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      endGuard();
      drag.end();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitId, direction, containerRef, resizeSplit]);

  return <div className="splitter" onMouseDown={onMouseDown} />;
}
