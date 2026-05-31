import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;          // '-' renders a separator
  disabled?: boolean;
  onClick?: () => void;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

/** A small dark popup menu positioned at (x, y). Closes on Escape, outside
 *  click, scroll, or window blur. Clamps itself to stay within the viewport. */
export function ContextMenu({ x, y, items, onClose }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = Math.min(x, window.innerWidth - r.width - 4);
    const ny = Math.min(y, window.innerHeight - r.height - 4);
    setPos({ x: Math.max(4, nx), y: Math.max(4, ny) });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  return (
    <>
      {/* Full-screen backdrop swallows the click that dismisses the menu. */}
      <div className="context-menu-backdrop" onMouseDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }}>
        {items.map((it, i) =>
          it.label === '-' ? (
            <div key={i} className="context-menu-sep" />
          ) : (
            <button
              key={i}
              className="context-menu-item"
              disabled={it.disabled}
              onClick={() => { it.onClick?.(); onClose(); }}
            >
              {it.label}
            </button>
          )
        )}
      </div>
    </>
  );
}
