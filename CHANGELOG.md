# Changelog

Alle nennenswerten Änderungen an DM Workspace. Neueste Version zuerst.

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
