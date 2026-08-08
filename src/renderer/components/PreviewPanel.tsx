import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteConnKey, useStore } from '../store';
import { beginDragGuard } from '../drag-guard';
import { createFilesApi } from '../files-api';
import { breadcrumbSegments, isFsRoot, parentDir } from '../../shared/fs-path';
import { resolveSource } from '../../shared/link-detect';
import type { DirEntry } from '../../shared/types';
import { Icon } from './Icon';
import { FileTree } from './FileTree';
import { FileEditor } from './FileEditor';
import { PreviewBody } from './PreviewBody';
import { ConfirmDialog } from './ConfirmDialog';

export function PreviewPanel(): React.JSX.Element | null {
  const { t } = useTranslation();
  const panel = useStore((s) => s.previewPanel);
  const closePreview = useStore((s) => s.closePreview);
  const setPreviewWidth = useStore((s) => s.setPreviewWidth);
  const setPanelTab = useStore((s) => s.setPanelTab);
  const setBrowseRoot = useStore((s) => s.setBrowseRoot);
  const openInEditor = useStore((s) => s.openInEditor);
  const clearEditor = useStore((s) => s.clearEditor);
  const openPreview = useStore((s) => s.openPreview);
  const activeCwd = useStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws?.cwd ?? '~';
  });
  // Remote-Workspace: der Files-Tab zeigt den Projektbaum des Servers; die
  // Rolle (Viewer = nur lesen) kommt aus dem Verbindungszustand.
  const activeRemote = useStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    return ws?.kind === 'remote' && ws.remote ? ws.remote : null;
  });
  // Die Datei-API des Servers ist projektgebunden (files/routes.ts kennt nur
  // Projekte) — für die persönliche User-Runtime gibt es sie noch nicht. Bis
  // die Server-API existiert, zeigt der Files-Tab dort nur einen Hinweis;
  // remoteCtx bleibt null, darf aber NICHT auf den lokalen Browser
  // zurückfallen (lokale Pfade wären im Container bedeutungslos).
  const remoteFilesUnavailable = activeRemote?.scope === 'user';
  const remoteCtx = useMemo(
    () => (activeRemote?.scope === 'project'
      ? { serverId: activeRemote.serverId, projectId: activeRemote.projectId }
      : null),
    [activeRemote]
  );
  const remoteRole = useStore((s) =>
    remoteCtx ? s.remote[remoteConnKey(remoteCtx.serverId, remoteCtx.projectId)]?.role ?? null : null
  );
  const filesApi = useMemo(() => createFilesApi(remoteCtx), [remoteCtx]);
  const canWrite = !remoteCtx || remoteRole !== 'viewer';

  const [refreshKey, setRefreshKey] = useState(0);
  const [newName, setNewName] = useState<string | null>(null); // non-null => the new-file input is showing
  const [newError, setNewError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DirEntry | null>(null); // non-null => confirm is showing
  const [actionError, setActionError] = useState<string | null>(null);

  const tab = panel.tab;

  // Drop a half-typed new-file input when leaving the Files tab so it doesn't
  // reappear (with a stale error) on return.
  useEffect(() => {
    if (tab !== 'files') { setNewName(null); setNewError(null); }
  }, [tab]);

  // Fall back to the active workspace's folder when no root has been chosen yet,
  // so opening the panel (incl. via the keyboard shortcut) always has a folder.
  // Remote workspaces always start at the project root '/'.
  const root = panel.browseRoot ?? (remoteCtx ? '/' : activeCwd);

  // Cleanup lives in a ref so an unmount mid-drag (panel closed while resizing)
  // also removes the window listeners, not just mouseup.
  const dragCleanup = useRef<(() => void) | null>(null);
  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const endGuard = beginDragGuard();
    const onMove = (ev: MouseEvent): void => setPreviewWidth(window.innerWidth - ev.clientX);
    const onUp = (): void => dragCleanup.current?.();
    dragCleanup.current = () => {
      dragCleanup.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      endGuard();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [setPreviewWidth]);
  useEffect(() => () => dragCleanup.current?.(), []);

  const pickRoot = useCallback(async () => {
    const dir = await window.api.pickDirectory();
    if (dir) setBrowseRoot(dir);
  }, [setBrowseRoot]);

  // "Preview" from a file's context menu: render it read-only in the preview tab.
  // resolveSource picks the renderer from the extension (markdown vs. the
  // sandboxed webview for html), the same mapping terminal links go through.
  // The path is absolute, so the cwd argument is never used.
  const onPreviewFile = useCallback((path: string) => {
    const source = resolveSource(path, '/');
    if (source) openPreview(source);
  }, [openPreview]);

  const submitNewFile = useCallback(async () => {
    if (newName === null) return;
    const name = newName.trim();
    if (!name) { setNewName(null); return; }
    setNewError(null);
    try {
      const res = await filesApi.createFile(root, name);
      if (res.ok) {
        setNewName(null);
        setNewError(null);
        setRefreshKey((k) => k + 1);
        openInEditor(res.path, remoteCtx);
      } else {
        setNewError(res.code === 'exists' ? t('files.errorExists') : t('files.errorInvalidName'));
      }
    } catch {
      setNewError(t('files.errorCreate'));
    }
  }, [filesApi, remoteCtx, root, newName, openInEditor, t]);

  const confirmDelete = useCallback(async () => {
    const entry = pendingDelete;
    if (!entry) return;
    setPendingDelete(null);
    setActionError(null);
    try {
      await filesApi.deletePath(entry.path);
      // Drop the inline editor if it (or its parent folder) just went to the trash.
      if (panel.editPath && (panel.editPath === entry.path || panel.editPath.startsWith(entry.path + '/'))) {
        clearEditor();
      }
      setRefreshKey((k) => k + 1);
    } catch {
      setActionError(t('files.errorDelete', { name: entry.name }));
    }
  }, [filesApi, pendingDelete, panel.editPath, clearEditor, t]);

  // Öffnen im Editor trägt die Herkunft mit, damit der Editor nach einem
  // Workspace-Wechsel weiter gegen die richtige Quelle lädt/speichert.
  const onOpenFile = useCallback((path: string) => openInEditor(path, remoteCtx), [openInEditor, remoteCtx]);

  if (!panel.open) return null;

  const crumbs = breadcrumbSegments(root);

  return (
    <div className="preview-panel" style={{ width: panel.widthPx }}>
      <div className="preview-resize" onMouseDown={onDragStart} />

      <div className="preview-tabs">
        <button type="button" className={`preview-tab-btn${tab === 'files' ? ' on' : ''}`} onClick={() => setPanelTab('files')}>{t('files.tabFiles')}</button>
        <button type="button" className={`preview-tab-btn${tab === 'preview' ? ' on' : ''}`} onClick={() => setPanelTab('preview')}>{t('files.tabPreview')}</button>
        <span className="preview-tabs-spacer" />
        {tab === 'files' && !remoteFilesUnavailable && (
          <>
            <button type="button" className="icon-btn" aria-label={t('files.upOneFolder')} disabled={isFsRoot(root)} onClick={() => setBrowseRoot(parentDir(root))}><Icon name="arrow-up" /></button>
            {canWrite && (
              <button type="button" className="icon-btn" aria-label={t('files.newFile')} onClick={() => { setNewName(''); setNewError(null); }}><Icon name="file-plus" /></button>
            )}
            <button type="button" className="icon-btn" aria-label={t('files.refresh')} onClick={() => setRefreshKey((k) => k + 1)}><Icon name="reload" /></button>
            {/* Der OS-Ordnerdialog ergibt für den Server-Projektbaum keinen Sinn. */}
            {!remoteCtx && (
              <button type="button" className="icon-btn" aria-label={t('files.chooseFolder')} onClick={() => { void pickRoot(); }}><Icon name="folder" /></button>
            )}
          </>
        )}
        <button type="button" className="icon-btn" aria-label={t('common.close')} onClick={closePreview}><Icon name="close" /></button>
      </div>

      {/* Both tabs stay mounted; we toggle visibility so the webview keeps its
          navigation history and the editor keeps unsaved edits across switches. */}
      <div className="files-tab" style={{ display: tab === 'files' ? 'flex' : 'none' }}>
        {remoteFilesUnavailable ? (
          // Persönliche User-Runtime: Datei-Panel deaktiviert, bis der Server
          // eine Datei-API für User-Runtimes anbietet (siehe activeRemote oben).
          <p className="modal-hint files-unavailable">{t('files.userRuntimeUnavailable')}</p>
        ) : (
        <>
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
              placeholder={t('files.namePlaceholder')}
              onChange={(e) => { setNewName(e.target.value); setNewError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); void submitNewFile(); }
                if (e.key === 'Escape') { setNewName(null); setNewError(null); }
              }}
              aria-label={t('files.newFileName')}
            />
            {newError && <span className="files-newerror">{newError}</span>}
          </div>
        )}
        {actionError && (
          <div className="files-newrow"><span className="files-newerror">{actionError}</span></div>
        )}
        {/* Remote: kein onPreviewFile — die Markdown-/HTML-Vorschau liest über
            lokale Pfade (file:read) und kennt den Server nicht. */}
        <FileTree
          root={root}
          refreshKey={refreshKey}
          api={filesApi}
          canWrite={canWrite}
          onOpenFile={onOpenFile}
          onPreviewFile={remoteCtx ? undefined : onPreviewFile}
          onRequestDelete={setPendingDelete}
        />
        </>
        )}
      </div>

      <div className="preview-region" style={{ display: tab === 'preview' ? 'flex' : 'none' }}>
        {panel.editPath ? <FileEditor path={panel.editPath} /> : <PreviewBody />}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.isDir ? t('files.deleteFolderTitle') : t('files.deleteFileTitle')}
          // Remote löscht endgültig auf dem Server — es gibt keinen Papierkorb.
          message={remoteCtx
            ? t('files.deleteMessageRemote', { name: pendingDelete.name })
            : pendingDelete.isDir
              ? t('files.deleteMessageFolder', { name: pendingDelete.name })
              : t('files.deleteMessage', { name: pendingDelete.name })}
          confirmLabel={t('common.delete')}
          tone="danger"
          onConfirm={() => { void confirmDelete(); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
