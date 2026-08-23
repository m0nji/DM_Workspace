import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { buildCommandList } from '../command-list';
import { Icon } from './Icon';

const isMac = navigator.userAgent.includes('Mac');

// Lightweight substring scoring: every query token must appear somewhere in the
// haystack; earlier matches rank higher. Keeps the list keyboard-fast.
function score(haystack: string, query: string): number {
  if (!query) return 1;
  const h = haystack.toLowerCase();
  let pos = 0;
  let total = 0;
  for (const token of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    const idx = h.indexOf(token, 0);
    if (idx === -1) return 0;
    total += idx;
    pos += 1;
  }
  return pos === 0 ? 1 : 1 / (1 + total);
}

export function CommandPalette(): React.JSX.Element | null {
  const { t } = useTranslation();
  const open = useStore((s) => s.commandPaletteOpen);
  const setOpen = useStore((s) => s.setCommandPaletteOpen);
  const workspaces = useStore((s) => s.workspaces);
  // Eigenes Abo, nicht aus actions gelesen: renameWorkspaceGroup und
  // setWorkspaceGroupCollapsed aendern NUR workspaceGroups. Ohne dieses Abo
  // rendert die Palette nicht neu, das Memo laeuft nicht, und der Eintrag boete
  // weiter "einklappen" an, obwohl die Gruppe laengst eingeklappt ist.
  const workspaceGroups = useStore((s) => s.workspaceGroups);
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const shortcutBindings = useStore((s) => s.settings.shortcutBindings);
  // Der Remote-Zustand entscheidet, ob ein Eintrag seinen Sperrgrund nennt.
  const remote = useStore((s) => s.remote);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  // Die Liste selbst lebt in command-list.ts — pure Funktion, ohne React
  // testbar. Hier bleiben nur die Abos, die bestimmen, wann sie neu entsteht.
  const commands = useMemo(
    () => buildCommandList({
      actions: useStore.getState(),
      workspaces, workspaceGroups, templates, activeWorkspaceId, focusedPaneId, shortcutBindings, remote,
      t,
      isMac,
      close: () => setOpen(false)
    }),
    [workspaces, workspaceGroups, templates, activeWorkspaceId, focusedPaneId, shortcutBindings, remote, setOpen, t]
  );

  const filtered = useMemo(() => {
    return commands
      .map((c) => ({ c, s: score(`${c.title} ${c.subtitle ?? ''} ${c.keywords ?? ''} ${c.category}`, query) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [commands, query]);

  // Reset query/selection each time the palette opens, and focus the input.
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // focus after the element mounts
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, filtered]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % Math.max(filtered.length, 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + filtered.length) % Math.max(filtered.length, 1)); return; }
    if (e.key === 'Enter') { e.preventDefault(); filtered[active]?.run(); return; }
  };

  // Render the list with category headers inserted when the category changes.
  let lastCategory = '';

  return (
    <div className="command-palette-backdrop" onMouseDown={() => setOpen(false)}>
      <div className="command-palette" onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <div className="command-input-row">
          <span className="command-search-icon"><Icon name="search" /></span>
          <input
            ref={inputRef}
            className="command-input"
            placeholder={t('palette.placeholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
        <div className="command-list" ref={listRef} role="listbox">
          {filtered.length === 0 && <div className="command-empty">{t('palette.empty')}</div>}
          {filtered.map((c, i) => {
            const header = c.category !== lastCategory ? c.category : null;
            lastCategory = c.category;
            return (
              <React.Fragment key={c.id}>
                {header && <div className="command-group">{header}</div>}
                <button
                  type="button"
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  className={`command-item ${i === active ? 'active' : ''}`}
                  onMouseMove={(e) => {
                    // Ignore synthetic mousemove events fired when keyboard nav
                    // scrolls a row under a stationary cursor (coords unchanged).
                    const last = lastMouse.current;
                    if (last && last.x === e.clientX && last.y === e.clientY) return;
                    lastMouse.current = { x: e.clientX, y: e.clientY };
                    setActive(i);
                  }}
                  onClick={() => c.run()}
                >
                  <span className="command-text">
                    <span className="command-title">{c.title}</span>
                    {c.subtitle && <span className="command-subtitle">{c.subtitle}</span>}
                  </span>
                  {c.hint && <kbd className="command-kbd">{c.hint}</kbd>}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
