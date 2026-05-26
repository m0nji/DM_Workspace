import React, { useCallback } from 'react';
import { useStore } from '../store';
import type { Direction } from '../../shared/types';

interface Props { splitId: string; direction: Direction; containerRef: React.RefObject<HTMLDivElement>; }

export function Splitter({ splitId, direction, containerRef }: Props): JSX.Element {
  const resizeSplit = useStore((s) => s.resizeSplit);

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: MouseEvent) => {
      const ratio = direction === 'h'
        ? (ev.clientX - rect.left) / rect.width
        : (ev.clientY - rect.top) / rect.height;
      resizeSplit(splitId, ratio);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [splitId, direction, containerRef, resizeSplit]);

  return <div className="splitter" onMouseDown={onMouseDown} />;
}
