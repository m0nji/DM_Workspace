import React, { useCallback, useState } from 'react';
import { useStore } from '../store';
import { breadcrumbSegments } from '../../shared/fs-path';
import { Icon } from './Icon';
import { FileTree } from './FileTree';
import { FileEditor } from './FileEditor';
import { PreviewBody } from './PreviewBody';

export function PreviewPanel(): React.JSX.Element | null {
  const panel = useStore((s) => s.previewPanel);
  const closePreview = useStore((s) => s.closePreview);
  const setPreviewWidth = useStore((s) => s.setPreviewWidth);
  const setPanelTab = useStore((s) => s.setPanelTab);
  const setBrowseRoot = useStore((s) => s.setBrowseRoot);
  const openInEditor = useStore((s) => s.openInEditor);
  const activeCwd = useStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws?.cwd ?? '~';
  });

  const [refreshKey, setRefreshKey] = useState(0);
  const [newName, setNewName] = useState<string | null>(null); // non-null => the new-file input is showing
  const [newError, setNewError] = useState<string | null>(null);

  // Fall back to the active workspace's folder when no root has been chosen yet,
  // so opening the panel (incl. via the keyboard shortcut) always has a folder.
  const root = panel.browseRoot ?? activeCwd;

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent): void => setPreviewWidth(window.innerWidth - ev.clientX);
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setPreviewWidth]);

  const pickRoot = useCallback(async () => {
    const dir = await window.api.pickDirectory();
    if (dir) setBrowseRoot(dir);
  }, [setBrowseRoot]);

  const submitNewFile = useCallback(async () => {
    if (newName === null) return;
    const name = newName.trim();
    if (!name) { setNewName(null); return; }
    const res = await window.api.createFile(root, name);
    if (res.ok) {
      setNewName(null);
      setNewError(null);
      setRefreshKey((k) => k + 1);
      openInEditor(res.path);
    } else {
      setNewError(res.code === 'exists' ? 'Existiert bereits' : 'Ungültiger Name');
    }
  }, [root, newName, openInEditor]);

  if (!panel.open) return null;

  const crumbs = breadcrumbSegments(root);

  return (
    <div className="preview-panel" style={{ width: panel.widthPx }}>
      <div className="preview-resize" onMouseDown={onDragStart} />

      <div className="preview-tabs">
        <button type="button" className={`preview-tab-btn${panel.tab === 'files' ? ' on' : ''}`} onClick={() => setPanelTab('files')}>Files</button>
        <button type="button" className={`preview-tab-btn${panel.tab === 'preview' ? ' on' : ''}`} onClick={() => setPanelTab('preview')}>Vorschau</button>
        <span className="preview-tabs-spacer" />
        {panel.tab === 'files' && (
          <>
            <button type="button" className="icon-btn" title="Neue Datei" aria-label="Neue Datei" onClick={() => { setNewName(''); setNewError(null); }}><Icon name="file-plus" /></button>
            <button type="button" className="icon-btn" title="Aktualisieren" onClick={() => setRefreshKey((k) => k + 1)}><Icon name="reload" /></button>
            <button type="button" className="icon-btn" title="Ordner wählen" aria-label="Ordner wählen" onClick={() => { void pickRoot(); }}><Icon name="folder" /></button>
          </>
        )}
        <button type="button" className="icon-btn" title="Schließen" onClick={closePreview}><Icon name="close" /></button>
      </div>

      {panel.tab === 'files' ? (
        <div className="files-tab">
          <div className="files-crumb">
            {crumbs.map((c, i) => (
              <React.Fragment key={c.path}>
                {i > 0 && <span className="files-crumb-sep">/</span>}
                <button type="button" className="files-crumb-seg" onClick={() => setBrowseRoot(c.path)}>{c.label}</button>
              </React.Fragment>
            ))}
          </div>
          {newName !== null && (
            <div className="files-newrow">
              <Icon name="file-text" size={16} />
              <input
                className="files-newinput"
                autoFocus
                value={newName}
                placeholder="Dateiname…"
                onChange={(e) => { setNewName(e.target.value); setNewError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void submitNewFile(); }
                  if (e.key === 'Escape') { setNewName(null); setNewError(null); }
                }}
                aria-label="Neuer Dateiname"
              />
              {newError && <span className="files-newerror">{newError}</span>}
            </div>
          )}
          <FileTree root={root} refreshKey={refreshKey} onOpenFile={openInEditor} />
        </div>
      ) : (
        panel.editPath ? <FileEditor path={panel.editPath} /> : <PreviewBody />
      )}
    </div>
  );
}
