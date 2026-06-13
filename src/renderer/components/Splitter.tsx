import React, { useCallback } from 'react';
import { useStore } from '../store';
import type { Direction } from '../../shared/types';

interface Props { splitId: string; direction: Direction; containerRef: React.RefObject<HTMLDivElement | null>; }

export function Splitter({ splitId, direction, containerRef }: Props): React.JSX.Element {
  const resizeSplit = useStore((s) => s.resizeSplit);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    let lastRatio = 0.5;

    const onMove = (ev: MouseEvent) => {
      lastRatio = direction === 'h'
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      resizeSplit(splitId, lastRatio, false);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      resizeSplit(splitId, lastRatio, true);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitId, direction, containerRef, resizeSplit]);

  return <div className="splitter" onMouseDown={onMouseDown} />;
}
