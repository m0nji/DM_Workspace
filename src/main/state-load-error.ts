import type { StateLoadError } from './persistence';

export function stateLoadErrorMessage(error: StateLoadError, locale: string): { message: string; detail: string } {
  const de = locale.toLowerCase().startsWith('de');
  return {
    message: de ? 'Workspace-Konfiguration konnte nicht geladen werden' : 'Workspace configuration could not be loaded',
    detail: de
      ? `DM Workspace wird beendet, damit Ihre Workspaces und Terminalverläufe erhalten bleiben. Die vorhandene Konfiguration wurde nicht überschrieben.\n\nDatei: ${error.file}\n\n${error.backupFile ? `Eine unveränderte Sicherung liegt hier:\n${error.backupFile}` : 'Die Datei konnte nicht gelesen oder gesichert werden. Prüfen Sie Zugriffsrechte und freien Speicherplatz.'}\n\nStellen Sie vor dem nächsten Start eine gültige state.json aus Ihrer Sicherung wieder her oder reparieren Sie die vorhandene Datei.`
      : `DM Workspace will close to preserve your workspaces and terminal history. The existing configuration has not been overwritten.\n\nFile: ${error.file}\n\n${error.backupFile ? `An unchanged backup is available here:\n${error.backupFile}` : 'The file could not be read or backed up. Check access permissions and free disk space.'}\n\nBefore starting again, restore a valid state.json from your backup or repair the existing file.`
  };
}
