// Wann ein mit show:false angelegtes Fenster gezeigt wird.
//
// Normalerweise ist das 'ready-to-show': der Renderer hat gezeichnet, das
// Fenster erscheint ohne Blank-Flash. Electron emittiert den Event aber
// ausschliesslich für ein Fenster, das noch nie gezeigt wurde — und
// maximize() zeigt ein verstecktes Fenster (ShowWindow(SW_MAXIMIZE)). Wird der
// gespeicherte maximierte Zustand vor dem Laden wiederhergestellt (nötig, damit
// die Panes gleich auf voller Breite fitten, siehe psreadline-initialx.spec.ts),
// bleibt 'ready-to-show' danach aus. Hing die Anzeige allein daran, startete die
// App in einen laufenden Prozess ohne Fenster — nicht sichtbar, nicht
// erreichbar, und von aussen nicht zu retten, weil ShowWindow() von Hand zwar
// den Rahmen zeigt, Chromium den Inhalt aber nicht komponiert. Das war der
// Zustand in 0.14.0 bis 0.14.2.
//
// Ausgelagert aus index.ts, damit diese Verdrahtung ohne echtes BrowserWindow
// prüfbar ist: ein E2E-Test kann sie nicht abdecken, weil Playwright sich per
// CDP an den Renderer hängt und damit das Zeichnen erzwingt — unter Playwright
// feuert 'ready-to-show' auch nach einem maximize(), im echten Start nicht.

/** Nur der Ausschnitt von BrowserWindow, den das Anzeigen braucht. */
export interface ShowableWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  show(): void;
  maximize(): void;
  hide(): void;
  once(event: 'ready-to-show', listener: () => void): unknown;
  webContents: { once(event: 'did-finish-load', listener: () => void): unknown };
}

export interface WireWindowShowOptions {
  /** Der gespeicherte Zustand war maximiert — vor dem Laden wiederherstellen. */
  restoreMaximized: boolean;
  /** Reissleine, falls kein Anzeige-Event kommt. 0 schaltet sie ab. */
  fallbackMs?: number;
  /** Wird gerufen, wenn die Reissleine greift (in index.ts: console.warn). */
  onFallback?: (message: string) => void;
}

const DEFAULT_FALLBACK_MS = 10_000;

/**
 * Stellt den maximierten Zustand wieder her und sorgt dafür, dass das Fenster
 * anschliessend auch wirklich gezeigt wird. Gibt eine Funktion zurück, die die
 * Reissleine abräumt (beim 'closed' des Fensters aufrufen).
 */
export function wireWindowShow(win: ShowableWindow, opts: WireWindowShowOptions): () => void {
  const fallbackMs = opts.fallbackMs ?? DEFAULT_FALLBACK_MS;
  let fallback: ReturnType<typeof setTimeout> | null = null;

  const cancelFallback = (): void => {
    if (fallback) { clearTimeout(fallback); fallback = null; }
  };

  const showNow = (): void => {
    cancelFallback();
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };

  if (opts.restoreMaximized) {
    // maximize() zeigt das Fenster — direkt wieder verstecken. getNormalBounds()
    // überlebt das unverändert, die gespeicherte Normalgrösse geht nicht verloren.
    win.maximize();
    win.hide();
    // 'ready-to-show' kommt nach dem maximize() nicht mehr; 'did-finish-load'
    // schon. Der Blank-Flash, gegen den show:false steht, ist hier kein Thema,
    // weil der Renderer bereits auf voller Breite layoutet hat.
    win.webContents.once('did-finish-load', showNow);
  } else {
    win.once('ready-to-show', showNow);
  }

  // Bleibt der Anzeige-Event aus welchem Grund auch immer aus, ist ein spät
  // gezeigtes Fenster immer noch besser als gar keins.
  if (fallbackMs > 0) {
    fallback = setTimeout(() => {
      fallback = null;
      if (!win.isDestroyed() && !win.isVisible()) {
        opts.onFallback?.(`kein Anzeige-Event nach ${fallbackMs}ms — Fenster wird per Fallback gezeigt`);
        win.show();
      }
    }, fallbackMs);
  }

  return cancelFallback;
}
