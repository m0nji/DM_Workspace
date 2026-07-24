import type { Terminal } from '@xterm/xterm';
import { clickMoveSequence, type RowMeta } from '../../shared/click-cursor';

export interface ClickToMoveOptions {
  paneId: string;
  /** Ob ein einfacher Klick auslösen darf (Einstellung clickMovesCursor). */
  plainClickEnabled: () => boolean;
  /** Der Aktivitätsmaschine melden, dass Eingabe stattgefunden hat. */
  onInput: () => void;
}

// Ab dieser Druckdauer gilt der Klick als Auswahlgeste, nicht als Sprung.
const LONG_PRESS_MS = 500;

/**
 * Klick → den Eingabecursor des laufenden Programms auf die geklickte Zelle
 * laufen lassen, ausschließlich mit ←/→ (die in diesen Editoren Zeilengrenzen
 * überschreiten). Die Tastenfolge geht an die PTY, damit das Programm (Shell,
 * Claude Code, Codex) seinen eigenen Cursor bewegt.
 *
 * Option/Alt+Klick löst immer aus; der einfache Klick nur, wenn die Einstellung
 * es erlaubt — sonst hat er eigene Aufgaben (Fokus, Auswahl, Links öffnen). Ein
 * Ziehen erzeugt eine Auswahl und bleibt unangetastet. Greift nur am unteren
 * Ende des Scrollbacks, wo der lebende Cursor steht.
 */
export function attachClickToMove(
  host: HTMLElement,
  term: Terminal,
  opts: ClickToMoveOptions
): () => void {
  const triggered = (e: MouseEvent): boolean => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) return false; // für Auswahl/Links reserviert
    if (e.altKey) return true;                              // Option/Alt+Klick: immer
    return opts.plainClickEnabled();
  };

  let downAt = -1;

  const onMouseDown = (e: MouseEvent): void => { downAt = triggered(e) ? e.timeStamp : -1; };

  const onMouseUp = (e: MouseEvent): void => {
    if (downAt < 0 || !triggered(e)) { downAt = -1; return; }
    const quick = e.timeStamp - downAt < LONG_PRESS_MS;
    downAt = -1;
    if (!quick || term.hasSelection()) return;
    const buf = term.buffer.active;
    if (buf.viewportY < buf.baseY) return; // hochgescrollt; der lebende Cursor ist nicht sichtbar
    const screen = host.querySelector('.xterm-screen') as HTMLElement | null;
    if (!screen) return;
    const rect = screen.getBoundingClientRect();
    const cellW = rect.width / term.cols;
    const cellH = rect.height / term.rows;
    if (!(cellW > 0) || !(cellH > 0)) return;
    let col = Math.floor((e.clientX - rect.left) / cellW);
    let row = Math.floor((e.clientY - rect.top) / cellH);
    col = Math.min(Math.max(col, 0), term.cols - 1);
    row = Math.min(Math.max(row, 0), term.rows - 1);
    // Länge und Umbruch-Flag je Zeile, damit der Lauf über Zeilenenden hinweg
    // zählen kann. Indiziert über dieselben Viewport-Zeilen wie Cursor und Ziel.
    const rowsMeta: RowMeta[] = [];
    for (let y = 0; y < term.rows; y++) {
      const line = buf.getLine(buf.baseY + y);
      rowsMeta.push({ length: (line?.translateToString(true) ?? '').length, wrapped: line?.isWrapped ?? false });
    }
    // Nicht in den leeren Raum hinter dem Zeilenende hinausschießen.
    col = Math.min(col, rowsMeta[row].length);
    const seq = clickMoveSequence(
      rowsMeta,
      { x: buf.cursorX, y: buf.cursorY },
      { x: col, y: row },
      term.modes.applicationCursorKeysMode
    );
    if (seq) {
      window.api.input({ paneId: opts.paneId, data: seq });
      opts.onInput();
    }
  };

  host.addEventListener('mousedown', onMouseDown, true);
  host.addEventListener('mouseup', onMouseUp, true);
  return () => {
    host.removeEventListener('mousedown', onMouseDown, true);
    host.removeEventListener('mouseup', onMouseUp, true);
  };
}
