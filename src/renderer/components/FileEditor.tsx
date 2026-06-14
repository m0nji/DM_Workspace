import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { renderMarkdown, isMarkdownFile } from '../markdown';
import { basename } from '../../shared/fs-path';
import { Icon } from './Icon';

type LoadState = 'loading' | 'ok' | 'binary' | 'too-large' | 'error';

export function FileEditor({ path }: { path: string }): React.JSX.Element {
  const setPanelTab = useStore((s) => s.setPanelTab);
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Guard the markdown render: bad input throwing here would crash the whole
  // renderer (no error boundary exists). Fall back to a notice instead.
  const renderedHtml = useMemo(() => {
    try { return renderMarkdown(content); }
    catch { return '<p><em>Preview could not be rendered.</em></p>'; }
  }, [content]);

  return (
    <div className="feditor">
      <div className="feditor-chrome">
        <button type="button" className="icon-btn" aria-label="Back to Files" onClick={() => setPanelTab('files')}>
          <Icon name="back" />
        </button>
        <span className="feditor-name" title={path}>
          {basename(path)}{dirty ? <span className="feditor-dirty" aria-label="unsaved">●</span> : null}
        </span>
        {isMd && state === 'ok' && (
          <button type="button" className="icon-btn" aria-label={mode === 'edit' ? 'Preview' : 'Edit'} onClick={() => setMode(mode === 'edit' ? 'render' : 'edit')}>
            <Icon name="preview" />
          </button>
        )}
        <button type="button" className="icon-btn feditor-save" aria-label="Save" disabled={!dirty} onClick={save}>
          <Icon name="save" />
        </button>
      </div>
      <div className="feditor-body">
        {state === 'loading' && <div className="feditor-notice">Loading…</div>}
        {state === 'binary' && <div className="feditor-notice">Binary file — can't be edited.</div>}
        {state === 'too-large' && <div className="feditor-notice">File too large to edit.</div>}
        {state === 'error' && <div className="feditor-notice">Couldn't load file.</div>}
        {state === 'ok' && (
          mode === 'render'
            ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
            : <textarea
                className="feditor-textarea"
                value={content}
                spellCheck={false}
                onChange={(e) => setContent(e.target.value)}
                aria-label={`Contents of ${basename(path)}`}
              />
        )}
      </div>
      {saveError && <div className="feditor-saveerror">Save failed.</div>}
    </div>
  );
}
