import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { renderMarkdown } from '../markdown';
import { basename } from '../../shared/fs-path';
import { Icon } from './Icon';

type LoadState = 'loading' | 'ok' | 'binary' | 'too-large' | 'error';

const MD_RE = /\.(md|markdown|mdx)$/i;

export function FileEditor({ path }: { path: string }): React.JSX.Element {
  const setPanelTab = useStore((s) => s.setPanelTab);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const [state, setState] = useState<LoadState>('loading');
  const [saveError, setSaveError] = useState(false);
  const [mode, setMode] = useState<'edit' | 'render'>('edit');

  const isMd = MD_RE.test(path);
  const dirty = content !== saved;

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setSaveError(false);
    setMode('edit');
    window.api.readTextFile(path).then((res) => {
      if (cancelled) return;
      if (res.ok) { setContent(res.content); setSaved(res.content); setState('ok'); }
      else setState(res.code);
    }).catch(() => { if (!cancelled) setState('error'); });
    return () => { cancelled = true; };
  }, [path]);

  const save = useCallback(() => {
    if (content === saved) return;
    window.api.writeTextFile(path, content)
      .then(() => { setSaved(content); setSaveError(false); })
      .catch(() => setSaveError(true));
  }, [content, saved, path]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save();
    }
  }, [save]);

  return (
    <div className="feditor" onKeyDown={onKeyDown}>
      <div className="feditor-chrome">
        <button type="button" className="icon-btn" title="Zurück zu Files" onClick={() => setPanelTab('files')}>
          <Icon name="back" />
        </button>
        <span className="feditor-name" title={path}>
          {basename(path)}{dirty ? <span className="feditor-dirty" aria-label="ungespeichert">●</span> : null}
        </span>
        {isMd && state === 'ok' && (
          <button type="button" className="icon-btn" title={mode === 'edit' ? 'Vorschau' : 'Bearbeiten'} onClick={() => setMode(mode === 'edit' ? 'render' : 'edit')}>
            <Icon name="preview" />
          </button>
        )}
        <button type="button" className="icon-btn feditor-save" title="Speichern" disabled={!dirty} onClick={save}>
          <Icon name="save" />
        </button>
      </div>
      <div className="feditor-body">
        {state === 'loading' && <div className="feditor-notice">Lädt …</div>}
        {state === 'binary' && <div className="feditor-notice">Binärdatei — kann nicht bearbeitet werden.</div>}
        {state === 'too-large' && <div className="feditor-notice">Datei zu groß zum Bearbeiten.</div>}
        {state === 'error' && <div className="feditor-notice">Datei konnte nicht geladen werden.</div>}
        {state === 'ok' && (
          mode === 'render'
            ? <div className="markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
            : <textarea
                className="feditor-textarea"
                value={content}
                spellCheck={false}
                onChange={(e) => setContent(e.target.value)}
                aria-label={`Inhalt von ${basename(path)}`}
              />
        )}
      </div>
      {saveError && <div className="feditor-saveerror">Speichern fehlgeschlagen.</div>}
    </div>
  );
}
