import type { Terminal } from '@xterm/xterm';
import { stripTrailingWhitespace } from '../../shared/copy-text';
import { formatPathsForInsert } from '../../shared/path-insert';

export interface ClipboardShortcutOptions {
  paneId: string;
  /** Der Aktivitätsmaschine melden, dass Eingabe stattgefunden hat. */
  onInput: () => void;
}

/**
 * Copy/Paste über die Plattform-Tastenkombination, am Host-Element mit
 * Capture registriert. Gibt den Disposer zurück, der beide Listener löst.
 */
export function attachClipboardShortcuts(
  host: HTMLElement,
  term: Terminal,
  opts: ClipboardShortcutOptions
): () => void {
  // Cmd+C (macOS): die native Kopie durch dieselbe Bereinigung schicken wie das
  // Kontextmenü, damit nachlaufende Füll-Leerzeichen (TUI-Kästen malen echte
  // Space-Zellen) nicht in der Zwischenablage landen. NUR die Plattform-Kombi:
  // Ctrl+C ist überall SIGINT und muss die Shell unberührt erreichen — deshalb
  // existiert dieser Handler ausschließlich auf macOS; anderswo kopiert man über
  // das Kontextmenü.
  const onCopy = (e: KeyboardEvent): void => {
    if (window.api.platform !== 'darwin') return;
    const isCopyKey = e.key.toLowerCase() === 'c' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (!isCopyKey || !term.hasSelection()) return;
    e.preventDefault();
    e.stopPropagation();
    window.api.clipboardWrite(stripTrailingWhitespace(term.getSelection()));
  };

  const onPaste = (e: KeyboardEvent): void => {
    // Nur die Plattform-Kombi zählt: Cmd+V auf macOS, Ctrl+V sonst. Auf macOS
    // muss Ctrl+V die Shell unberührt erreichen (readline quoted-insert, vims
    // Visual Block), dort darf ctrlKey also nicht als Paste-Modifier gelten.
    const primaryMod = window.api.platform === 'darwin'
      ? e.metaKey && !e.ctrlKey
      : e.ctrlKey && !e.metaKey;
    const isPasteKey = e.key.toLowerCase() === 'v' && primaryMod && !e.altKey;
    if (!isPasteKey) return;

    e.preventDefault();
    e.stopPropagation();

    void window.api.clipboardRead().then(async (text) => {
      if (text) {
        // Text in der Zwischenablage (z. B. diktierter Text): direkt einfügen.
        // Der Umweg über den Main-Prozess funktioniert auch dort, wo die
        // Zwischenablage des Renderers nicht verfügbar ist.
        term.paste(text);
        opts.onInput();
        return;
      }
      // Kein Text — liegt ein Bild an, in eine temporäre Datei schreiben und
      // deren Pfad einfügen. Das ist werkzeugunabhängig (Claude Code, Codex,
      // opencode lesen alle einen Pfad) und funktioniert unter Windows, wo
      // CLI-Werkzeuge die OS-Zwischenablage nicht zuverlässig selbst lesen.
      // Nur wenn das Speichern scheitert, reichen wir Ctrl+V (0x16) weiter,
      // damit das Programm es selbst versuchen kann.
      if (await window.api.clipboardHasImage()) {
        const file = await window.api.clipboardSaveImage();
        if (file) {
          term.paste(formatPathsForInsert([file], window.api.platform));
        } else {
          window.api.input({ paneId: opts.paneId, data: '\x16' });
        }
        opts.onInput();
      }
    });
  };

  host.addEventListener('keydown', onCopy, true);
  host.addEventListener('keydown', onPaste, true);
  return () => {
    host.removeEventListener('keydown', onCopy, true);
    host.removeEventListener('keydown', onPaste, true);
  };
}
