import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { remoteConnKey, useStore } from '../store';
import { createFilesApi, type FilesErrorCode } from '../files-api';
import { renderMarkdown, isMarkdownFile, handleMarkdownLinkClick } from '../markdown';
import { basename } from '../../shared/fs-path';
import { Icon } from './Icon';

type LoadState = 'loading' | 'ok' | 'binary' | 'too-large' | 'error';

// Fehlercodes der Datei-Schicht -> i18n-Schlüssel. 'server' bleibt bewusst auf
// den generischen Meldungen der jeweiligen Stelle (Laden/Speichern). Das
// Literal-Union hält die strenge i18next-Key-Typisierung intakt.
type FilesErrorKey =
  | 'files.remoteNotLoggedIn' | 'files.remoteForbidden' | 'files.remoteNotFound'
  | 'files.remoteNetwork' | 'files.tooLargeLimit' | 'files.saveFailed';
const ERROR_KEYS: Partial<Record<FilesErrorCode, FilesErrorKey>> = {
  'not-logged-in': 'files.remoteNotLoggedIn',
  forbidden: 'files.remoteForbidden',
  'not-found': 'files.remoteNotFound',
  network: 'files.remoteNetwork',
  'too-large': 'files.tooLargeLimit'
};

export function FileEditor({ path }: { path: string }): React.JSX.Element {
  const { t } = useTranslation();
  const setPanelTab = useStore((s) => s.setPanelTab);
  const panelTab = useStore((s) => s.previewPanel.tab);
  // Herkunft der Datei (lokal oder Remote-Projekt) — vom Files-Tab beim Öffnen
  // mitgegeben, damit ein Workspace-Wechsel die Quelle nicht umdeutet.
  const editRemote = useStore((s) => s.previewPanel.editRemote);
  const remoteRole = useStore((s) =>
    editRemote ? s.remote[remoteConnKey(editRemote.serverId, editRemote.projectId)]?.role ?? null : null
  );
  const filesApi = useMemo(() => createFilesApi(editRemote), [editRemote]);
  // Viewer dürfen serverseitig nicht schreiben — der Editor wird zum Betrachter.
  const readOnly = editRemote !== null && remoteRole === 'viewer';

  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [loadErrorKey, setLoadErrorKey] = useState<FilesErrorKey | null>(null);
  const [saveErrorKey, setSaveErrorKey] = useState<FilesErrorKey | null>(null);
  // 409 vom Server: Basis-mtime passte nicht mehr -> Konflikthinweis mit den
  // zwei Auswegen „neu laden" (Serverstand übernehmen) oder „überschreiben".
  const [conflict, setConflict] = useState(false);
  const [mode, setMode] = useState<'edit' | 'render'>('edit');
  // mtime des zuletzt gelesenen/geschriebenen Stands — Basis für das
  // serverseitige optimistic Locking (lokal undefined, dort gibt es keins).
  const mtimeRef = useRef<number | undefined>(undefined);

  // Tracks the file currently loaded so an in-flight save/load that resolves
  // after the user navigates to another file can't write back stale state.
  const pathRef = useRef(path);

  const isMd = isMarkdownFile(path);
  const dirty = content !== saved;

  const load = useCallback((): (() => void) => {
    pathRef.current = path;
    let cancelled = false;
    setState('loading');
    setLoadErrorKey(null);
    setSaveErrorKey(null);
    setConflict(false);
    setMode('edit');
    mtimeRef.current = undefined;
    // Clear content/saved so a stale dirty state from the previous file can't
    // be force-written to this path during the async load window.
    setContent('');
    setSaved('');
    filesApi.readTextFile(path).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        mtimeRef.current = res.mtime;
        setContent(res.content); setSaved(res.content); setState('ok');
      } else if (res.code === 'binary' || res.code === 'too-large') {
        setState(res.code);
      } else {
        setLoadErrorKey(ERROR_KEYS[res.code] ?? null);
        setState('error');
      }
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [filesApi, path]);

  useEffect(() => load(), [load]);

  // Speichern; overwrite=true lässt das optimistic Locking bewusst aus (die
  // „Überschreiben"-Entscheidung im Konfliktfall).
  const write = useCallback((overwrite: boolean) => {
    const target = path;
    filesApi.writeTextFile(target, content, overwrite ? undefined : mtimeRef.current)
      .then((res) => {
        if (pathRef.current !== target) return;
        if (res.ok) {
          mtimeRef.current = res.mtime;
          setSaved(content); setSaveErrorKey(null); setConflict(false);
        } else if (res.code === 'conflict') {
          setConflict(true);
        } else {
          setSaveErrorKey(ERROR_KEYS[res.code] ?? 'files.saveFailed');
        }
      })
      .catch(() => { if (pathRef.current === target) setSaveErrorKey('files.saveFailed'); });
  }, [filesApi, content, path]);

  const save = useCallback(() => {
    if (readOnly || content === saved) return;
    write(false);
  }, [readOnly, content, saved, write]);

  // Cmd/Ctrl+S saves from anywhere in the panel — including markdown preview
  // mode, where the textarea is unmounted and a div-level handler never fires.
  // Window-level, so it must yield whenever the editor isn't the active surface:
  // only the platform's primary chord counts (Ctrl+S on macOS belongs to the
  // shell), only while the editor tab is visible, and never when the keystroke
  // targets a terminal (Ctrl+S there is flow control/XOFF, not save).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const primary = window.api.platform === 'darwin' ? e.metaKey : e.ctrlKey;
      if (!primary || e.shiftKey || e.altKey || e.key.toLowerCase() !== 's') return;
      if (panelTab !== 'preview') return;
      if ((e.target as HTMLElement | null)?.closest?.('.xterm')) return;
      e.preventDefault();
      save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, panelTab]);

  // Guard the markdown render: bad input throwing here would crash the whole
  // renderer (no error boundary exists). Fall back to a notice instead.
  const renderedHtml = useMemo(() => {
    try { return renderMarkdown(content); }
    catch { return `<p><em>${t('files.previewRenderError')}</em></p>`; }
  }, [content, t]);

  return (
    <div className="feditor">
      <div className="feditor-chrome">
        <button type="button" className="icon-btn" aria-label={t('files.backToFiles')} onClick={() => setPanelTab('files')}>
          <Icon name="back" />
        </button>
        <span className="feditor-name" title={path}>
          {basename(path)}{dirty ? <span className="feditor-dirty" aria-label={t('files.unsaved')}>●</span> : null}
        </span>
        {readOnly && <span className="feditor-ro">{t('files.readOnlyViewer')}</span>}
        {isMd && state === 'ok' && (
          <button type="button" className="icon-btn" aria-label={mode === 'edit' ? t('files.preview') : t('files.edit')} onClick={() => setMode(mode === 'edit' ? 'render' : 'edit')}>
            <Icon name="preview" />
          </button>
        )}
        {!readOnly && (
          <button type="button" className="icon-btn feditor-save" aria-label={t('common.save')} disabled={!dirty} onClick={save}>
            <Icon name="save" />
          </button>
        )}
      </div>
      <div className="feditor-body">
        {state === 'loading' && <div className="feditor-notice">{t('files.loading')}</div>}
        {state === 'binary' && <div className="feditor-notice">{t('files.binary')}</div>}
        {state === 'too-large' && <div className="feditor-notice">{t(editRemote ? 'files.tooLargeLimit' : 'files.tooLarge')}</div>}
        {state === 'error' && <div className="feditor-notice">{t(loadErrorKey ?? 'files.editorLoadError')}</div>}
        {state === 'ok' && (
          mode === 'render'
            ? <div className="markdown-body" onClick={handleMarkdownLinkClick} dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            : <textarea
                className="feditor-textarea"
                value={content}
                readOnly={readOnly}
                spellCheck={false}
                onChange={(e) => setContent(e.target.value)}
                aria-label={t('files.contentsOf', { name: basename(path) })}
              />
        )}
      </div>
      {conflict && (
        <div className="feditor-conflict" role="alert">
          <span className="feditor-conflict-msg">{t('files.conflictMessage')}</span>
          <button type="button" className="confirm-btn" onClick={() => { setConflict(false); load(); }}>
            {t('files.conflictReload')}
          </button>
          <button type="button" className="confirm-btn confirm-btn-danger" onClick={() => write(true)}>
            {t('files.conflictOverwrite')}
          </button>
        </div>
      )}
      {!conflict && saveErrorKey && <div className="feditor-saveerror">{t(saveErrorKey)}</div>}
    </div>
  );
}
