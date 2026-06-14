# Changelog

Alle nennenswerten Änderungen an DM Workspace. Neueste Version zuerst.

## 0.8.0 – 2026-06-14
- feat: Neuer Datei-Browser als Tab im rechten Panel – durch die Ordnerstruktur navigieren und Dateien ansehen, mit Dateityp-Symbolen und einer anklickbaren Pfadleiste
- feat: Textdateien lassen sich direkt im Panel bearbeiten und speichern (Speichern-Knopf oder Cmd/Strg+S); neue Dateien legt der „+"-Knopf an
- feat: Rechtsklick auf eine Markdown-Datei bietet „Preview" (gerendert) und „Edit"; eine Datei aus dem Browser ins Terminal ziehen fügt deren Pfad ein
- fix: Der Hintergrund des rechten Panels passt jetzt exakt zur linken Seitenleiste

## 0.7.18 – 2026-06-14
- fix: Das „Was ist neu"-Fenster ist jetzt wirklich so breit wie das Einstellungen-Menü – der vorige Versuch hatte technisch nicht gegriffen
- fix: Kurze „unerwartet beendet"-Fehlermeldung direkt nach einem Update behoben – beim Einspielen werden die Terminals jetzt sauber beendet, bevor sich das Programm schließt

## 0.7.17 – 2026-06-13
- perf: Inaktive Workspaces geben ihren Grafikspeicher (WebGL) wieder frei – deutlich weniger Arbeitsspeicher- und GPU-Verbrauch bei vielen Workspaces. Der Terminalinhalt bleibt erhalten, und beim Zurückwechseln ist das Terminal sofort wieder da

## 0.7.16 – 2026-06-13
- fix: Das „Was ist neu"- und das Update-Fenster sind jetzt etwas breiter (so breit wie das Einstellungen-Menü), damit der Text nicht mehr gequetscht wirkt

## 0.7.15 – 2026-06-13
- feat: Beim Ziehen einer Datei über das Terminal erscheint jetzt eine schicke Ablegefläche – der Hintergrund wird weichgezeichnet und ein Hinweis zeigt, dass der Pfad eingefügt wird
- feat: Klick auf die Versionsnummer unten links öffnet ein „Was ist neu"-Fenster mit den letzten Änderungen
- feat: Ist ein Update verfügbar, zeigt ein Dialog die Neuerungen und fragt vor dem Einspielen noch einmal nach

## 0.7.14 – 2026-06-11
- feat: Bilder lassen sich jetzt zuverlässig per Strg+V / Cmd+V ins Terminal einfügen – plattformübergreifend und unabhängig vom Tool (Claude, Codex, opencode …)
- feat: Dateien aus dem Datei-Explorer per Drag & Drop ins Terminal ziehen fügt deren Pfad ein
- fix: Die Ziel-Auswahl beim Ausführen eines Tasks heißt jetzt verständlich „Terminal oben/unten/links/rechts" statt eines kryptischen Kürzels
- fix: Das Auswahlmenü für das Ziel-Terminal wird nicht mehr abgeschnitten

## 0.7.13 – 2026-06-11
- fix: Beim Ziehen des Trenners (reine Höhenänderung) passt sich das Terminal wieder korrekt an

## 0.7.12 – 2026-06-10
- fix: Keine grellen nativen Scrollbalken mehr unter macOS bei aktiver Einstellung „Scrollleisten immer einblenden"

## 0.7.11 – 2026-06-09
- feat: Terminal-Transparenz standardmäßig auf 0,95 gesetzt für besseren Kontrast
- fix: Schlanker Scrollbalken im macOS-Stil ohne Streifen am rechten Rand
- fix: Scrollbalken-Griff bleibt verborgen, bis man darüberfährt

## 0.7.10 – 2026-06-08
- feat: Automatische Update-Prüfung alle 60 Minuten mit gut sichtbarem Hinweis oben rechts
- fix: Schwarzer Balken am unteren Rand jedes Panes entfernt
- perf: WebGL-Renderer aktiviert – flüssigeres Scrollen und Tippen
