// Fehlermeldungen aus der IPC-Brücke anzeigbar machen.
//
// Electron verpackt jede über `ipcRenderer.invoke` geworfene Ausnahme als
// "Error invoking remote method '<kanal>': <OriginalError>". Wird das
// ungefiltert angezeigt, liest der Nutzer den Kanalnamen der Brücke — im
// Dialog "Neuer Remote-Workspace" stand vor diesem Modul
// "Error invoking remote method 'remote:projects': Error: Nicht angemeldet",
// und zwar im ganz normalen Zustand "noch nicht angemeldet".
//
// Für Meldungen, die der Nutzer sehen soll, geht der Weg über ein
// `{ ok: false, error }`-Ergebnis statt über einen Throw (siehe
// RemoteLoginResult in shared/types.ts). Wo eine Route noch wirft, macht diese
// Funktion aus der Ausnahme wenigstens einen lesbaren Satz.

const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/;
const ERROR_PREFIX = /^[A-Za-z]*Error:\s*/;

/** Kürzt eine IPC-Ausnahme auf die eigentliche Meldung; nie leer. */
export function describeIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const cleaned = raw.replace(IPC_PREFIX, '').replace(ERROR_PREFIX, '').trim();
  // Eine leere Zeile wäre schlimmer als eine unschöne: der Nutzer sähe ein
  // rotes Feld ohne Inhalt und wüsste nicht einmal, dass etwas schiefging.
  return cleaned || 'Unbekannter Fehler';
}
