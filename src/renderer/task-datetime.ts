// Zeitpunkte im Tasks-Panel einheitlich formatieren.
//
// Warum eigenes Modul und nicht `new Date(iso).toLocaleString()` in der
// Komponente: Ohne Argument nimmt `toLocaleString` die Sprache des
// BETRIEBSSYSTEMS, nicht die im Programm eingestellte. Auf einem
// englischsprachigen macOS stand dadurch "8/9/2026, 11:23:31 PM" mitten in
// einer deutschen Oberfläche (bei der Prüfung gegen den laufenden Server
// aufgefallen; der Web-Client zeigte daneben korrekt "09.08.2026, 23:23").
//
// Die Felder sind ausdrücklich gesetzt statt über `dateStyle`/`timeStyle`:
// Letztere unterscheiden sich zwischen ICU-Versionen, womit weder die Anzeige
// noch ein Test darüber verlässlich wäre.
const OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
};

/**
 * Formatiert einen ISO-Zeitpunkt in der übergebenen Sprache; `null` wird zum
 * Gedankenstrich. `locale` ist i18nexts aktuelle Sprache ('de', 'en', auch mit
 * Regionsteil wie 'de-AT'). Eine Sprache, die die Laufzeit nicht kennt, fällt
 * auf Englisch zurück, statt die Anzeige mit einer Ausnahme zu zerreißen.
 */
export function formatDateTime(iso: string | null, locale: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, OPTIONS).format(date);
  } catch {
    return new Intl.DateTimeFormat('en', OPTIONS).format(date);
  }
}
