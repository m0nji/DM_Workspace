import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { findNext, findPrevious, clearSearch } from '../search-registry';

interface Props { paneId: string; }

// A small find overlay for one pane. Visible when the store's searchOpenPaneId
// matches this pane (set by the Cmd/Ctrl+F shortcut). Enter / Shift+Enter cycle
// matches; Esc closes.
export function SearchBar({ paneId }: Props): React.JSX.Element | null {
  const open = useStore((s) => s.searchOpenPaneId === paneId);
  const setSearchOpen = useStore((s) => s.setSearchOpen);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { inputRef.current?.focus(); inputRef.current?.select(); }
  }, [open]);

  if (!open) return null;

  const close = (): void => { clearSearch(paneId); setSearchOpen(null); };

  return (
    <div className="search-bar" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="search-input"
        placeholder="Find"
        value={query}
        onChange={(e) => { setQuery(e.target.value); findNext(paneId, e.target.value); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); if (e.shiftKey) findPrevious(paneId, query); else findNext(paneId, query); }
          else if (e.key === 'Escape') { e.preventDefault(); close(); }
        }}
      />
      <button className="search-btn" title="Previous" onClick={() => findPrevious(paneId, query)}>↑</button>
      <button className="search-btn" title="Next" onClick={() => findNext(paneId, query)}>↓</button>
      <button className="search-btn" title="Close" onClick={close}>✕</button>
    </div>
  );
}
