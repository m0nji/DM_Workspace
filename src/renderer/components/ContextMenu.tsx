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

/** A small dark popup menu positioned at (x, y), with full keyboard menu
 *  semantics so every caller gets it for free: role="menu"/"menuitem" (and
 *  "separator" for a '-' item), focus moves to the first enabled item on
 *  open, ArrowUp/ArrowDown/Home/End/Tab cycle between enabled items without
 *  ever leaving the menu, Enter/Space activate the focused item (native
 *  <button> behaviour — not handled here), and focus returns to whatever
 *  triggered the menu (the same pattern ConfirmDialog uses) once it closes.
 *  Closes on Escape, outside click, scroll, or window blur. Clamps itself to
 *  stay within the viewport. */
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

  // The menu portals to .root, so without this Tab would leave it for
  // whatever the portal target happens to contain next, and closing would
  // strand focus on <body> instead of returning it to the trigger (e.g. the
  // agent settings row's "⋯" button).
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLButtonElement>('.context-menu-item:not(:disabled)');
    first?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);

  useEffect(() => {
    const enabledItems = (): HTMLButtonElement[] =>
      Array.from(ref.current?.querySelectorAll<HTMLButtonElement>('.context-menu-item:not(:disabled)') ?? []);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(e.key)) return;
      const enabled = enabledItems();
      if (enabled.length === 0) return;
      const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
      let next: number;
      if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) next = index + 1;
      else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) next = index - 1;
      else if (e.key === 'Home') next = 0;
      else next = enabled.length - 1;
      e.preventDefault();
      enabled[(next + enabled.length) % enabled.length]?.focus();
    };
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
      <div ref={ref} className="context-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
        {items.map((it, i) =>
          it.label === '-' ? (
            <div key={i} className="context-menu-sep" role="separator" />
          ) : (
            <button
              key={i}
              role="menuitem"
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
