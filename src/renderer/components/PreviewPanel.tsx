import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { renderMarkdown } from '../markdown';

// Minimal typing for the Electron <webview> element methods we call.
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
}

export function PreviewPanel(): JSX.Element | null {
  const panel = useStore((s) => s.previewPanel);
  const closePreview = useStore((s) => s.closePreview);
  const setPreviewWidth = useStore((s) => s.setPreviewWidth);

  const webviewRef = useRef<WebviewEl | null>(null);
  const [mdHtml, setMdHtml] = useState<string>('');
  const [addr, setAddr] = useState<string>('');

  const source = panel.source;
  const isMarkdown = source?.kind === 'markdown';

  // Load + render markdown when the source changes.
  useEffect(() => {
    if (!panel.open || !source || source.kind !== 'markdown') return;
    let cancelled = false;
    setAddr(source.target);
    window.api
      .readFile(source.target)
      .then((text) => { if (!cancelled) setMdHtml(renderMarkdown(text)); })
      .catch((err) => { if (!cancelled) setMdHtml(`<p class="preview-error">Datei konnte nicht geladen werden: ${String(err)}</p>`); });
    return () => { cancelled = true; };
  }, [panel.open, source]);

  // Reflect webview navigation into the address field.
  useEffect(() => {
    if (isMarkdown) return;
    const wv = webviewRef.current;
    if (!wv) return;
    const onNav = (): void => setAddr(wv.getURL());
    wv.addEventListener('did-navigate', onNav as EventListener);
    wv.addEventListener('did-navigate-in-page', onNav as EventListener);
    return () => {
      wv.removeEventListener('did-navigate', onNav as EventListener);
      wv.removeEventListener('did-navigate-in-page', onNav as EventListener);
    };
  }, [isMarkdown, panel.open, source]);

  // Drag the left edge to resize. Width = distance from the cursor to the window's right edge.
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

  const reload = useCallback(() => {
    if (isMarkdown) {
      if (source) window.api.readFile(source.target).then((t) => setMdHtml(renderMarkdown(t))).catch(() => {});
    } else {
      webviewRef.current?.reload();
    }
  }, [isMarkdown, source]);

  if (!panel.open) return null;

  return (
    <div className="preview-panel" style={{ width: panel.widthPx }}>
      <div className="preview-resize" onMouseDown={onDragStart} />
      <div className="preview-chrome">
        {!isMarkdown && (
          <>
            <button type="button" title="Zurück" onClick={() => webviewRef.current?.goBack()}>◀</button>
            <button type="button" title="Vor" onClick={() => webviewRef.current?.goForward()}>▶</button>
          </>
        )}
        <button type="button" title="Neu laden" onClick={reload}>⟳</button>
        <input className="preview-addr" value={addr} readOnly title={addr} />
        <button type="button" title="Schließen" onClick={closePreview}>✕</button>
      </div>
      <div className="preview-body">
        {!source ? (
          <div className="preview-empty">Keine Vorschau</div>
        ) : isMarkdown ? (
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: mdHtml }} />
        ) : (
          <webview ref={webviewRef as React.Ref<WebviewEl>} src={source.target} className="preview-webview" />
        )}
      </div>
    </div>
  );
}
