import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, IconName } from './Icon';
import { ContextMenu, MenuItem } from './ContextMenu';
import { isMarkdownFile } from '../markdown';
import type { DirEntry } from '../../shared/types';

// Map a filename to a flat icon + a tint class. Config patterns win over the
// generic code/text fallbacks (e.g. .json reads as config, not code).
function classifyFile(name: string): { icon: IconName; tint: string } {
  if (/\.(json|ya?ml|toml|ini|conf|config|env|lock)$/i.test(name)) return { icon: 'file-config', tint: 'ft-cfg' };
  if (/\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|sh|py|rs|go|java|rb|c|cpp|h|hpp)$/i.test(name)) return { icon: 'file-code', tint: 'ft-code' };
  return { icon: 'file-text', tint: 'ft-doc' };
}

function setDragPayload(e: React.DragEvent, path: string): void {
  // Internal payload the terminal drop handler recognises; text/plain is a
  // friendly fallback for any other drop target.
  e.dataTransfer.setData('application/x-dmws-path', path);
  e.dataTransfer.setData('text/plain', path);
  e.dataTransfer.effectAllowed = 'copy';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface NodeProps {
  entry: DirEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onOpenFile: (path: string) => void;
  onContext: (e: React.MouseEvent, entry: DirEntry) => void;
}

function TreeNode({ entry, depth, selectedPath, onSelect, onOpenFile, onContext }: NodeProps): React.JSX.Element {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const loadChildren = useCallback(() => {
    if (inFlight.current) return; // ignore a second expand while a read is pending
    inFlight.current = true;
    window.api.readDir(entry.path)
      .then((list) => { inFlight.current = false; setChildren(list); setError(null); })
      .catch((err: unknown) => { inFlight.current = false; setError(String(err)); });
  }, [entry.path]);

  const toggle = useCallback(() => {
    if (!entry.isDir) return;
    const next = !open;
    setOpen(next);
    if (next && children === null) loadChildren();
  }, [entry.isDir, open, children, loadChildren]);

  const onClick = useCallback(() => onSelect(entry.path), [onSelect, entry.path]);
  const onDouble = useCallback(() => {
    if (entry.isDir) toggle(); else onOpenFile(entry.path);
  }, [entry.isDir, toggle, onOpenFile, entry.path]);
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); onDouble(); }
  }, [onDouble]);

  const cls = entry.isDir
    ? { icon: (open ? 'folder-open' : 'folder') as IconName, tint: 'ft-dir' }
    : classifyFile(entry.name);
  const selected = selectedPath === entry.path;

  return (
    <>
      <div
        className={`ftree-row${selected ? ' sel' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        draggable
        onDragStart={(e) => setDragPayload(e, entry.path)}
        onClick={onClick}
        onDoubleClick={onDouble}
        onContextMenu={(e) => { e.preventDefault(); onSelect(entry.path); onContext(e, entry); }}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="treeitem"
        aria-expanded={entry.isDir ? open : undefined}
        title={entry.path}
      >
        <span className="ftree-chev">
          {entry.isDir ? <Icon name={open ? 'chevron-down' : 'forward'} size={12} /> : null}
        </span>
        <span className={`ftree-ic ${cls.tint}`}><Icon name={cls.icon} size={16} /></span>
        <span className="ftree-name">{entry.name}</span>
        {!entry.isDir && <span className="ftree-meta">{formatSize(entry.size)}</span>}
      </div>
      {entry.isDir && open && (
        error
          ? <div className="ftree-error" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>{t('files.accessDenied')}</div>
          : children === null
            ? <div className="ftree-empty" style={{ paddingLeft: 6 + (depth + 1) * 14 }}>{t('files.loading')}</div>
            : children.map((c) => (
                <TreeNode key={c.path} entry={c} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} onOpenFile={onOpenFile} onContext={onContext} />
              ))
      )}
    </>
  );
}

interface FileTreeProps {
  root: string;
  refreshKey: number;       // bump to force a reload of the root
  onOpenFile: (path: string) => void;
  onPreviewFile?: (path: string) => void; // rendered preview (offered for markdown)
  onRequestDelete: (entry: DirEntry) => void; // open a confirm before trashing
}

export function FileTree({ root, refreshKey, onOpenFile, onPreviewFile, onRequestDelete }: FileTreeProps): React.JSX.Element {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEntries(null);
    setError(null);
    setSelectedPath(null);
    window.api.readDir(root)
      .then((list) => { if (!cancelled) setEntries(list); })
      .catch((err: unknown) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [root, refreshKey]);

  // Right-click any entry for its actions: Preview/Edit (files) plus Delete.
  const onContext = useCallback((e: React.MouseEvent, entry: DirEntry) => {
    setMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  if (error) return <div className="ftree-error">{t('files.readError')}</div>;
  if (entries === null) return <div className="ftree-empty">{t('files.loading')}</div>;
  if (entries.length === 0) return <div className="ftree-empty">{t('files.emptyFolder')}</div>;

  const menuItems: MenuItem[] = menu
    ? [
        ...(!menu.entry.isDir && onPreviewFile && isMarkdownFile(menu.entry.name)
          ? [{ label: t('files.preview'), onClick: () => onPreviewFile(menu.entry.path) }]
          : []),
        ...(!menu.entry.isDir
          ? [{ label: t('files.edit'), onClick: () => onOpenFile(menu.entry.path) }]
          : []),
        { label: t('common.delete'), onClick: () => onRequestDelete(menu.entry) }
      ]
    : [];

  return (
    <div className="ftree" role="tree">
      {entries.map((e) => (
        <TreeNode key={e.path} entry={e} depth={0} selectedPath={selectedPath} onSelect={setSelectedPath} onOpenFile={onOpenFile} onContext={onContext} />
      ))}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  );
}
