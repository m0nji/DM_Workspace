import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../store';
import { renderMarkdown, isMarkdownFile } from '../markdown';
import { basename } from '../../shared/fs-path';
import { Icon } from './Icon';

type LoadState = 'loading' | 'ok' | 'binary' | 'too-large' | 'error';

export function FileEditor({ path }: { path: string }): React.JSX.Element {
  const { t } = useTranslation();
  const setPanelTab = useStore((s) => s.setPanelTab);
  const panelTab = useStore((s) => s.previewPanel.tab);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [saveError, setSaveError] = useState(false);
  const [mode, setMode] = useState<'edit' | 'render'>('edit');

  // Tracks the file currently loaded so an in-flight save/load that resolves
  // after the user navigates to another file can't write back stale state.
  const pathRef = useRef(path);

  const isMd = isMarkdownFile(path);
  const dirty = content !== saved;

  useEffect(() => {
    pathRef.current = path;
    let cancelled = false;
    setState('loading');
    setSaveError(false);
    setMode('edit');
    // Clear content/saved so a stale dirty state from the previous file can't
    // be force-written to this path during the async load window.
    setContent('');
    setSaved('');
    window.api.readTextFile(path).then((res) => {
      if (cancelled) return;
      if (res.ok) { setContent(res.content); setSaved(res.content); setState('ok'); }
      else setState(res.code);
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [path]);

  const save = useCallback(() => {
    if (content === saved) return;
    const target = path;
    window.api.writeTextFile(target, content)
      .then(() => { if (pathRef.current === target) { setSaved(content); setSaveError(false); } })
      .catch(() => { if (pathRef.current === target) setSaveError(true); });
  }, [content, saved, path]);

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
        {isMd && state === 'ok' && (
          <button type="button" className="icon-btn" aria-label={mode === 'edit' ? t('files.preview') : t('files.edit')} onClick={() => setMode(mode === 'edit' ? 'render' : 'edit')}>
            <Icon name="preview" />
          </button>
        )}
        <button type="button" className="icon-btn feditor-save" aria-label={t('common.save')} disabled={!dirty} onClick={save}>
          <Icon name="save" />
        </button>
      </div>
      <div className="feditor-body">
        {state === 'loading' && <div className="feditor-notice">{t('files.loading')}</div>}
        {state === 'binary' && <div className="feditor-notice">{t('files.binary')}</div>}
        {state === 'too-large' && <div className="feditor-notice">{t('files.tooLarge')}</div>}
        {state === 'error' && <div className="feditor-notice">{t('files.editorLoadError')}</div>}
        {state === 'ok' && (
          mode === 'render'
            ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            : <textarea
                className="feditor-textarea"
                value={content}
                spellCheck={false}
                onChange={(e) => setContent(e.target.value)}
                aria-label={t('files.contentsOf', { name: basename(path) })}
              />
        )}
      </div>
      {saveError && <div className="feditor-saveerror">{t('files.saveFailed')}</div>}
    </div>
  );
}
