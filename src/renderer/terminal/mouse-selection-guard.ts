import type { Terminal } from '@xterm/xterm';

/**
 * Schützt die Auswahl, solange ein Programm die Maus verfolgt (Codex schaltet
 * DECSET 1003 + SGR 1006 ein). xterm meldet dann jede Mausbewegung und den
 * Rechtsklick als Eingabe an die PTY — und jede Eingabe löscht die Auswahl.
 * Eine Shift+Ziehen-Auswahl (macOS: Option+Ziehen) war so weg, bevor das Kontextmenü „Kopieren“
 * anbieten konnte.
 *
 * - Rechte Taste: gehört unserem Kontextmenü und geht nie ans Programm. Das
 *   contextmenu-Event bleibt unberührt, damit das Menü weiter aufgeht.
 * - Bewegung ohne gedrückte Taste: wird nur zurückgehalten, solange eine
 *   Auswahl existiert; ohne Auswahl bekommt das Programm sein Hover wie gehabt.
 * - Rechtsklick neben die Auswahl: xterm ersetzt auf macOS
 *   (rightClickSelectsWord) die Auswahl durch das Wort unter dem Zeiger, auf
 *   leerer Fläche also durch nichts. Mit Auswahl bleibt sie deshalb stehen;
 *   ohne Auswahl markiert der Rechtsklick weiter das Wort.
 *
 * Capture-Phase am Host, also vor xterms Listenern am .xterm-Element darunter.
 */
export function attachMouseSelectionGuard(host: HTMLElement, term: Terminal): () => void {
  const tracking = (): boolean => term.modes.mouseTrackingMode !== 'none';
  const selectsWord = term.options.rightClickSelectsWord ?? false;

  const onButton = (e: MouseEvent): void => {
    if (e.button === 2 && tracking()) e.stopPropagation();
  };
  const onMove = (e: MouseEvent): void => {
    if (e.buttons === 0 && tracking() && term.hasSelection()) e.stopPropagation();
  };
  const onContextMenu = (): void => {
    term.options.rightClickSelectsWord = selectsWord && !term.hasSelection();
  };

  host.addEventListener('mousedown', onButton, true);
  host.addEventListener('mouseup', onButton, true);
  host.addEventListener('mousemove', onMove, true);
  host.addEventListener('contextmenu', onContextMenu, true);
  return () => {
    host.removeEventListener('mousedown', onButton, true);
    host.removeEventListener('mouseup', onButton, true);
    host.removeEventListener('mousemove', onMove, true);
    host.removeEventListener('contextmenu', onContextMenu, true);
  };
}
