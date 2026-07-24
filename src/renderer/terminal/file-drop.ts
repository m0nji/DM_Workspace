import type { Terminal } from '@xterm/xterm';
import { formatPathsForInsert } from '../../shared/path-insert';

export interface FileDropOptions {
  /** Der Aktivitätsmaschine melden, dass Eingabe stattgefunden hat. */
  onInput: () => void;
}

/**
 * Dateien aus dem OS-Dateibrowser (oder dem eigenen Datei-Panel) in die
 * Terminalzeile ziehen: eingefügt wird der PFAD jeder Datei — werkzeugunabhängig,
 * jedes Programm liest einen Pfad —, statt Electron das Fenster zur Datei
 * navigieren zu lassen.
 */
export function attachFileDrop(host: HTMLElement, term: Terminal, opts: FileDropOptions): () => void {
  const onDragOver = (e: DragEvent): void => {
    const types = e.dataTransfer?.types;
    if (!types || (!types.includes('Files') && !types.includes('application/x-dmws-path'))) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    host.classList.add('drop-target');
  };

  const onDragLeave = (e: DragEvent): void => {
    // Nur löschen, wenn der Zeiger den Host wirklich verlässt (nicht beim
    // Betreten eines Kindelements).
    if (e.relatedTarget && host.contains(e.relatedTarget as Node)) return;
    // Bei OS-Dateidrags ist relatedTarget oft null (Chromium hält es zurück),
    // deshalb zusätzlich die Zeigerposition prüfen.
    const r = host.getBoundingClientRect();
    if (e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom) return;
    host.classList.remove('drop-target');
  };

  const onDrop = (e: DragEvent): void => {
    host.classList.remove('drop-target');
    // Interner Drag aus dem Dateibrowser: ein einzelner absoluter Pfad.
    const internal = e.dataTransfer?.getData('application/x-dmws-path');
    if (internal) {
      e.preventDefault();
      term.paste(formatPathsForInsert([internal], window.api.platform));
      term.focus();
      opts.onInput();
      return;
    }
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    e.preventDefault();
    const paths = Array.from(files)
      .map((f) => window.api.getPathForFile(f))
      .filter((p) => p && p.length > 0);
    if (paths.length === 0) return;
    term.paste(formatPathsForInsert(paths, window.api.platform));
    term.focus();
    opts.onInput();
  };

  host.addEventListener('dragover', onDragOver);
  host.addEventListener('dragleave', onDragLeave);
  host.addEventListener('drop', onDrop);
  return () => {
    host.removeEventListener('dragover', onDragOver);
    host.removeEventListener('dragleave', onDragLeave);
    host.removeEventListener('drop', onDrop);
  };
}
