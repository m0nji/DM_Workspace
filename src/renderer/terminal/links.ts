import type { Terminal } from '@xterm/xterm';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { findLinks, resolveSource, fileTarget } from '../../shared/link-detect';
import { useStore } from '../store';

export interface LinkHandlingOptions {
  paneId: string;
  /** cwd zum Spawn-Zeitpunkt; gilt, bis die Shell ein lebendes cwd meldet. */
  spawnCwd: string;
}

/**
 * Klicks auf Links öffnen das rechte Preview-Panel statt des OS-Browsers.
 * Erfasst werden http(s)-URLs (über WebLinksAddon) und nackte *.md/*.html/*.htm-
 * Pfade in der Ausgabe (über einen eigenen LinkProvider).
 */
export function attachLinkHandling(term: Terminal, opts: LinkHandlingOptions): () => void {
  // Schützt davor, dass das Ergebnis eines älteren Klicks ein neueres überschreibt.
  let latestCall = 0;

  const openInPreview = async (raw: string): Promise<void> => {
    const { paneCwd, workspaces } = useStore.getState();
    const liveCwd = paneCwd[opts.paneId] ?? opts.spawnCwd;
    const src = resolveSource(raw, liveCwd);
    if (!src) return;
    if (!src.rel) {
      // URL oder absoluter Pfad — das vorläufige Ziel direkt öffnen.
      useStore.getState().openPreview(src);
      return;
    }
    // Relativer Pfad — im Main-Prozess gegen die Kandidatenbasen prüfen.
    const roots = workspaces.map((w) => w.cwd);
    const callId = ++latestCall;
    let abs: string | null;
    try {
      abs = await window.api.resolveLink(src.rel, liveCwd, roots);
    } catch {
      abs = null; // IPC fehlgeschlagen → zurück auf die "nicht gefunden"-Oberfläche
    }
    if (callId !== latestCall) return; // ein neuerer Klick hat diesen überholt
    if (abs) {
      useStore.getState().openPreview({ ...src, target: fileTarget(src.kind, abs), resolved: true });
    } else {
      useStore.getState().openPreview({ ...src, resolved: false });
    }
  };

  const webLinks = new WebLinksAddon((_event: MouseEvent | undefined, uri: string) => {
    void openInPreview(uri);
  });
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
        activate: () => { void openInPreview(m.text); }
      })));
    }
  });

  return () => {
    provider.dispose();
    webLinks.dispose();
  };
}
