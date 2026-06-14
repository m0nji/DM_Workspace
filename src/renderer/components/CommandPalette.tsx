import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { resolveShortcuts, formatShortcut, type ShortcutAction } from '../../shared/shortcuts';
import { Icon } from './Icon';

const isMac = navigator.userAgent.includes('Mac');

interface CommandItem {
  id: string;
  title: string;
  subtitle?: string;   // shown muted under the title
  category: string;    // grouping label, e.g. 'Actions' / 'Workspaces' / 'Templates'
  hint?: string;       // right-aligned kbd hint (a formatted shortcut)
  keywords?: string;   // extra searchable text
  run: () => void;
}

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
  const templates = useStore((s) => s.workspaceTemplates ?? []);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const shortcutBindings = useStore((s) => s.settings.shortcutBindings);

  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastMouse = useRef<{ x: number; y: number } | null>(null);

  const commands = useMemo<CommandItem[]>(() => {
    const s = useStore.getState();
    const bindings = resolveShortcuts(shortcutBindings, isMac);
    const hint = (a: ShortcutAction): string => formatShortcut(bindings[a], isMac);
    const activeWs = workspaces.find((w) => w.id === activeWorkspaceId);
    const close = (): void => setOpen(false);
    const act = (fn: () => void) => () => { close(); fn(); };

    const catActions = t('palette.group.actions');
    const catTemplates = t('palette.group.templates');
    const catWorkspaces = t('palette.group.workspaces');

    const list: CommandItem[] = [];

    list.push({ id: 'new-workspace', title: t('palette.cmd.newWorkspace'), category: catActions, hint: hint('newWorkspace'), run: act(() => s.addWorkspace()) });

    if (focusedPaneId) {
      list.push(
        { id: 'split-h', title: t('palette.cmd.splitHorizontal'), category: catActions, hint: hint('splitHorizontal'), run: act(() => s.splitActivePane(focusedPaneId, 'h')) },
        { id: 'split-v', title: t('palette.cmd.splitVertical'), category: catActions, hint: hint('splitVertical'), run: act(() => s.splitActivePane(focusedPaneId, 'v')) },
        { id: 'maximize', title: t('palette.cmd.toggleMaximize'), category: catActions, hint: hint('toggleMaximize'), run: act(() => s.toggleMaximize(focusedPaneId)) },
        { id: 'search', title: t('palette.cmd.searchPane'), category: catActions, hint: hint('searchPane'), run: act(() => s.setSearchOpen(focusedPaneId)) },
        { id: 'close-pane', title: t('palette.cmd.closePane'), category: catActions, hint: hint('closePane'), run: act(() => s.closeActivePane(focusedPaneId)) }
      );
    }

    list.push(
      { id: 'toggle-preview', title: t('palette.cmd.togglePreview'), category: catActions, hint: hint('togglePreview'), run: act(() => s.togglePreview()) },
      { id: 'open-file-browser', title: t('palette.cmd.openFileBrowser'), category: catActions, run: act(() => s.openFiles()) },
      { id: 'open-settings', title: t('palette.cmd.openSettings'), category: catActions, hint: hint('openSettings'), run: act(() => s.setSettingsOpen(true)) },
      { id: 'open-shortcuts', title: t('palette.cmd.openShortcuts'), category: catActions, keywords: 'keybindings rebind', run: act(() => s.setSettingsOpen(true, 'shortcuts')) }
    );

    if (activeWs?.layout) {
      list.push({ id: 'save-template', title: t('palette.cmd.saveTemplate'), category: catTemplates, run: act(() => s.setTemplateWizard({ open: true, templateId: null })) });
    }

    workspaces.forEach((w, idx) => {
      if (w.id === activeWorkspaceId) return;
      list.push({
        id: `switch-${w.id}`,
        title: t('palette.cmd.switchToWorkspace', { name: w.name }),
        subtitle: w.cwd,
        category: catWorkspaces,
        // Mod+1..9 jumps to the workspace at that position in the sidebar.
        hint: idx < 9 ? formatShortcut(`Mod+${idx + 1}`, isMac) : undefined,
        keywords: w.cwd,
        run: act(() => s.selectWorkspace(w.id))
      });
    });

    templates.forEach((tpl) => {
      // requestTemplateLaunch closes the palette itself (it may instead open the
      // confirm dialog), so it is NOT wrapped in act() to avoid a double-close.
      list.push({ id: `tpl-run-${tpl.id}`, title: t('palette.cmd.newFromTemplate', { name: tpl.name }), subtitle: tpl.cwd, category: catTemplates, run: () => s.requestTemplateLaunch(tpl.id) });
      list.push({ id: `tpl-edit-${tpl.id}`, title: t('palette.cmd.editTemplate', { name: tpl.name }), category: catTemplates, run: act(() => s.setTemplateWizard({ open: true, templateId: tpl.id })) });
      list.push({ id: `tpl-del-${tpl.id}`, title: t('palette.cmd.deleteTemplate', { name: tpl.name }), category: catTemplates, run: act(() => s.deleteWorkspaceTemplate(tpl.id)) });
    });

    return list;
  }, [workspaces, templates, activeWorkspaceId, focusedPaneId, shortcutBindings, setOpen, t]);

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
