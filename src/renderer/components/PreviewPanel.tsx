import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { renderMarkdown } from '../markdown';
import { resolveSource, fileTarget } from '../../shared/link-detect';

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
  const openPreview = useStore((s) => s.openPreview);

  const webviewRef = useRef<WebviewEl | null>(null);
  const [mdHtml, setMdHtml] = useState<string>('');
  const [addr, setAddr] = useState<string>('');

  const source = panel.source;
  const isMarkdown = source?.kind === 'markdown';

  // Load + render markdown when the source changes (skip unresolved sources).
  useEffect(() => {
    if (!panel.open || !source || source.kind !== 'markdown' || !source.resolved) return;
    let cancelled = false;
    setAddr(source.target);
    window.api
      .readFile(source.target)
      .then((text) => { if (!cancelled) setMdHtml(renderMarkdown(text)); })
      .catch((err) => { if (!cancelled) setMdHtml(`<p class="preview-error">Datei konnte nicht geladen werden: ${String(err)}</p>`); });
    return () => { cancelled = true; };
  }, [panel.open, source]);

  // Keep the address field populated for unresolved sources so it can be edited.
  useEffect(() => {
    if (source && !source.resolved) setAddr(source.target);
  }, [source]);

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

  // Enter in the address bar: treat the typed value as an absolute path / url and open it.
  const submitAddr = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const s = resolveSource(addr.trim(), '/');
    if (s) openPreview(s);
  }, [addr, openPreview]);

  // Pick a folder and re-resolve the original relative path against it.
  const pickAndResolve = useCallback(async () => {
    const rel = source?.rel;
    if (!rel) return;
    const dir = await window.api.pickDirectory();
    if (!dir) return;
    const abs = await window.api.resolveLink(rel, dir, []);
    if (abs) {
      openPreview({ kind: source!.kind, target: fileTarget(source!.kind, abs), rel, resolved: true });
    } else {
      openPreview({ kind: source!.kind, target: `${dir.replace(/\/+$/, '')}/${rel}`, rel, resolved: false });
    }
  }, [source, openPreview]);

  if (!panel.open) return null;

  const notFound = !!source && !source.resolved;

  return (
    <div className="preview-panel" style={{ width: panel.widthPx }}>
      <div className="preview-resize" onMouseDown={onDragStart} />
      <div className="preview-chrome">
        {!isMarkdown && !notFound && (
          <>
            <button type="button" title="Zurück" onClick={() => webviewRef.current?.goBack()}>◀</button>
            <button type="button" title="Vor" onClick={() => webviewRef.current?.goForward()}>▶</button>
          </>
        )}
        <button type="button" title="Neu laden" onClick={reload}>⟳</button>
        <input
          className="preview-addr"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={submitAddr}
          title={addr}
        />
        {notFound && <button type="button" title="Ordner wählen" onClick={() => { void pickAndResolve(); }}>📁</button>}
        <button type="button" title="Schließen" onClick={closePreview}>✕</button>
      </div>
      <div className="preview-body">
        {!source ? (
          <div className="preview-empty">Keine Vorschau</div>
        ) : notFound ? (
          <div className="preview-notfound">
            Datei nicht gefunden — Pfad in der Adresszeile korrigieren oder mit 📁 den richtigen Ordner wählen.
          </div>
        ) : isMarkdown ? (
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: mdHtml }} />
        ) : (
          <webview ref={webviewRef as React.Ref<WebviewEl>} src={source.target} className="preview-webview" />
        )}
      </div>
    </div>
  );
}
