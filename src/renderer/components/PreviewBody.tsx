import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { renderMarkdown } from '../markdown';
import { resolveSource, fileTarget } from '../../shared/link-detect';
import { escapeHtml } from '../../shared/html';
import { Icon } from './Icon';

interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
}

// Renders the "Preview" tab content for a PreviewSource (markdown or web/url).
// This is the pre-existing preview behaviour, unchanged, minus the outer panel
// shell and resize handle (now owned by PreviewPanel).
export function PreviewBody(): React.JSX.Element {
  const panel = useStore((s) => s.previewPanel);
  const openPreview = useStore((s) => s.openPreview);

  const webviewRef = useRef<WebviewEl | null>(null);
  const [mdHtml, setMdHtml] = useState<string>('');
  const [addr, setAddr] = useState<string>('');

  const source = panel.source;
  const isMarkdown = source?.kind === 'markdown';

  useEffect(() => {
    if (!panel.open || !source || source.kind !== 'markdown' || !source.resolved) return;
    let cancelled = false;
    setAddr(source.target);
    window.api.readFile(source.target)
      .then((text) => { if (!cancelled) setMdHtml(renderMarkdown(text)); })
      .catch((err) => { if (!cancelled) setMdHtml(`<p class="preview-error">Couldn't load file: ${escapeHtml(String(err))}</p>`); });
    return () => { cancelled = true; };
  }, [panel.open, source]);

  useEffect(() => {
    if (source && !source.resolved) setAddr(source.target);
  }, [source]);

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

  const reload = useCallback(() => {
    if (isMarkdown) {
      if (source?.resolved) window.api.readFile(source.target)
        .then((t) => setMdHtml(renderMarkdown(t)))
        .catch((err) => setMdHtml(`<p class="preview-error">Couldn't load file: ${escapeHtml(String(err))}</p>`));
    } else {
      webviewRef.current?.reload();
    }
  }, [isMarkdown, source]);

  const submitAddr = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    const v = addr.trim();
    if (!v || (!v.startsWith('/') && !/^https?:\/\//i.test(v) && !/^[A-Za-z]:[\\/]/.test(v))) return;
    const s = resolveSource(v, '/');
    if (s) openPreview(s);
  }, [addr, openPreview]);

  const pickAndResolve = useCallback(async () => {
    const snap = source;
    if (!snap?.rel) return;
    const rel = snap.rel;
    const dir = await window.api.pickDirectory();
    if (!dir) return;
    const base = dir.replace(/\/+$/, '');
    const abs = await window.api.resolveLink(rel, base, []);
    if (abs) openPreview({ ...snap, target: fileTarget(snap.kind, abs), resolved: true });
    else openPreview({ ...snap, target: fileTarget(snap.kind, `${base}/${rel}`), resolved: false });
  }, [source, openPreview]);

  const notFound = !!source && !source.resolved;

  return (
    <div className="preview-tab">
      <div className="preview-chrome">
        {!isMarkdown && !notFound && (
          <>
            <button type="button" className="icon-btn" aria-label="Back" onClick={() => webviewRef.current?.goBack()}><Icon name="back" /></button>
            <button type="button" className="icon-btn" aria-label="Forward" onClick={() => webviewRef.current?.goForward()}><Icon name="forward" /></button>
          </>
        )}
        <button type="button" className="icon-btn" aria-label="Reload" onClick={reload}><Icon name="reload" /></button>
        <input
          className="preview-addr"
          value={addr}
          onChange={(e) => setAddr(e.target.value)}
          onKeyDown={submitAddr}
          readOnly={!notFound}
          aria-label="Preview address"
          title={addr}
        />
        {notFound && <button type="button" className="icon-btn" aria-label="Choose folder" onClick={() => { void pickAndResolve(); }}><Icon name="folder" /></button>}
      </div>
      <div className="preview-body">
        {!source ? (
          <div className="preview-empty">No preview</div>
        ) : notFound ? (
          <div className="preview-notfound">
            File not found — fix the path in the address bar or pick the right folder with 📁.
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
