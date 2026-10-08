import type { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { findLinks, resolveSource, fileTarget, type PreviewSource } from '../../shared/link-detect';
import { useStore } from '../store';

export interface LinkHandlingOptions {
  paneId: string;
  /** cwd zum Spawn-Zeitpunkt; gilt, bis die Shell ein lebendes cwd meldet. */
  spawnCwd: string;
}

export interface LinkHandling {
  dispose(): void;
  /** Link unter dem Mauszeiger (für das Kontextmenü), sonst null. */
  hoveredLink(): string | null;
  openInPreview(raw: string): Promise<void>;
  /** Öffnet URL oder lokale .html-Datei im Standardbrowser; false, wenn nichts geöffnet wurde. */
  openInBrowser(raw: string): Promise<boolean>;
}

/** Nur http(s)-URLs und HTML-Dateien ergeben im Browser Sinn — Markdown nicht. */
export function canOpenInBrowser(raw: string): boolean {
  return /^https?:\/\//i.test(raw) || /\.html?$/i.test(raw);
}

/**
 * Klicks auf Links öffnen das rechte Preview-Panel statt des OS-Browsers; über das
 * Kontextmenü (Rechtsklick auf den Link) geht es alternativ in den Standardbrowser.
 * Erfasst werden http(s)-URLs (über WebLinksAddon) und nackte *.md/*.html/*.htm-
 * Pfade in der Ausgabe (über einen eigenen LinkProvider).
 */
export function attachLinkHandling(term: Terminal, opts: LinkHandlingOptions): LinkHandling {
  // Schützt davor, dass das Ergebnis eines älteren Klicks ein neueres überschreibt.
  let latestCall = 0;
  let hovered: string | null = null;

  // Löst den Rohtext gegen das lebende cwd auf. Relative Pfade prüft der
  // Main-Prozess gegen die Kandidatenbasen; null = Klick wurde überholt.
  const resolve = async (raw: string): Promise<PreviewSource | null> => {
    const { paneCwd, workspaces } = useStore.getState();
    const liveCwd = paneCwd[opts.paneId] ?? opts.spawnCwd;
    const src = resolveSource(raw, liveCwd);
    if (!src) return null;
    // URL oder absoluter Pfad — das vorläufige Ziel direkt verwenden.
    if (!src.rel) return src;
    const roots = workspaces.map((w) => w.cwd);
    const callId = ++latestCall;
    let abs: string | null;
    try {
      abs = await window.api.resolveLink(src.rel, liveCwd, roots);
    } catch {
      abs = null; // IPC fehlgeschlagen → zurück auf die "nicht gefunden"-Oberfläche
    }
    if (callId !== latestCall) return null; // ein neuerer Klick hat diesen überholt
    return abs ? { ...src, target: fileTarget(src.kind, abs), resolved: true } : { ...src, resolved: false };
  };

  const openInPreview = async (raw: string): Promise<void> => {
    const src = await resolve(raw);
    if (src) useStore.getState().openPreview(src);
  };

  const openInBrowser = async (raw: string): Promise<boolean> => {
    if (!canOpenInBrowser(raw)) return false;
    const src = await resolve(raw);
    if (!src || !src.resolved || src.kind !== 'web') return false;
    try { return await window.api.openInBrowser(src.target); } catch { return false; }
  };

  // xterm aktiviert einen Link bei JEDEM mouseup über ihm — auch beim Rechtsklick,
  // der stattdessen das Kontextmenü mit "Im Browser öffnen" zeigen soll.
  const activate = (event: MouseEvent | undefined, raw: string): void => {
    if (event && event.button !== 0) return;
    void openInPreview(raw);
  };
  const hover = (_event: MouseEvent, text: string): void => { hovered = text; };
  const leave = (): void => { hovered = null; };

  const webLinks = new WebLinksAddon(activate, { hover, leave });
  term.loadAddon(webLinks);

  const provider = term.registerLinkProvider({
    provideLinks(lineNo, callback) {
      const line = term.buffer.active.getLine(lineNo - 1);
      if (!line) { callback(undefined); return; }
      const text = line.translateToString(true);
      const matches = findLinks(text).filter((m) => !/^https?:\/\//i.test(m.text));
      if (matches.length === 0) { callback(undefined); return; }
      callback(matches.map((m) => ({
        range: {
          start: { x: m.startIndex + 1, y: lineNo },
          end: { x: m.startIndex + m.length, y: lineNo }
        },
        text: m.text,
        activate: (event) => activate(event, m.text),
        hover: (event) => hover(event, m.text),
        leave
      })));
    }
  });

  return {
    dispose: () => {
      provider.dispose();
      webLinks.dispose();
    },
    hoveredLink: () => hovered,
    openInPreview,
    openInBrowser
  };
}
