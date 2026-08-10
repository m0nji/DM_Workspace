// Umrechnung zwischen den drei Darstellungen des Arbeitsverzeichnisses eines
// geplanten Tasks:
//
//   Formularwert  relativ, '.' für die Wurzel — genau das erwartet der Server
//                 (validateWorkdir in server/src/tasks/schedule.ts)
//   Anzeigepfad   absolut ab /workspace — beantwortet die Frage „wo bin ich?",
//                 die das Formular bisher offen liess
//   API-Pfad      relativ, '' für die Wurzel — so verlangt es die Datei-API
//                 (GET /api/projects/:id/files?path=)
//
// Rein und ohne React, damit die Umrechnung ohne gerendertes Formular prüfbar
// bleibt — wie task-schedule.ts nebenan.

/** Basis aller Projektpfade in der Server-Laufzeit (tasks/runner.ts: cwd '/workspace'). */
export const WORKSPACE_ROOT = '/workspace';

// Segmentweise statt per Regex-Kette: Die Wurzel hat viele Schreibweisen
// ('.', '/', '/.', './'), und nacheinander angewandte Ersetzungen lassen
// immer eine davon stehen — hier fiel '/.' als '.' durch und wäre als
// Pfad an die Datei-API gegangen, die '' für die Wurzel erwartet.
function normalize(raw: string): string {
  return raw
    .trim()
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.')
    .join('/');
}

/** Formularwert → absoluter Anzeigepfad. */
export function toAbsPath(workdir: string): string {
  const rel = normalize(workdir);
  return rel ? `${WORKSPACE_ROOT}/${rel}` : WORKSPACE_ROOT;
}

/**
 * Absoluter Pfad → Formularwert. Ein Pfad ausserhalb von /workspace wird
 * unverändert durchgereicht statt stillschweigend zurechtgebogen: Er kann so
 * gar nicht erst entstehen (der Picker läuft nur unterhalb der Wurzel), und
 * eine stille Korrektur verstecke einen Fehler, statt ihn zu zeigen.
 */
export function toWorkdir(absPath: string): string {
  const trimmed = absPath.trim().replace(/\/+$/, '');
  if (trimmed === WORKSPACE_ROOT) return '.';
  if (!trimmed.startsWith(`${WORKSPACE_ROOT}/`)) return absPath.trim();
  return normalize(trimmed.slice(WORKSPACE_ROOT.length)) || '.';
}

/** Formularwert → Pfad für die Datei-API ('' ist dort die Wurzel, nicht '.'). */
export function toFsPath(workdir: string): string {
  return normalize(workdir);
}
