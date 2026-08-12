import { basename } from '../shared/fs-path';

// Ein Pane in einem Satz benennen -- gebraucht dort, wo ein Pane ueber ein
// ANDERES spricht und dessen Kopfzeile nicht sehen kann: der Drop-Hinweis
// waehrend des Drags nennt die Quelle beim Namen.
//
// Der Pane-Kopf selbst zeigt Ordner und Beschriftung nebeneinander; hier muss
// es ein einzelner kurzer Ausdruck sein. Rangfolge: Beschriftung (manuell oder
// automatisch), sonst der Basisname des Arbeitsverzeichnisses.
export function paneDisplayName(label: string, cwd: string): string {
  const trimmedLabel = label.trim();
  if (trimmedLabel) return trimmedLabel;
  const trimmedCwd = cwd.trim();
  if (!trimmedCwd) return '';
  // basename('/') ist leer -- ein Wurzelpfad ist sein eigener bester Name.
  return basename(trimmedCwd) || trimmedCwd;
}
