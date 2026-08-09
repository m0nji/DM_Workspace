#!/usr/bin/env bash
#
# Signiert, notarisiert und stapelt das gebaute .dmg — und zieht anschließend
# Blockmap und Updater-Metadaten nach.
#
# Warum das nötig ist: electron-builder notarisiert die .app, nicht den
# Container, in dem sie ausgeliefert wird. Bis einschließlich 0.9.41 ging das
# .dmg deshalb unsigniert und unnotarisiert raus — am veröffentlichten
# 0.9.41-Artefakt nachgeprüft: kein Ticket, „no usable signature". Aufgefallen
# ist es nie, weil die .app darin ihr eigenes Ticket trägt und nach dem
# Herausziehen startet; das .dmg selbst bestand Gatekeeper aber nicht.
#
# Reihenfolge ist wesentlich: Das Stapeln schreibt das .dmg um, seine Prüfsumme
# ändert sich also. latest-mac.yml und die .blockmap entstehen davor und müssen
# danach neu erzeugt werden — sonst beschreiben die Updater-Metadaten eine Datei,
# die es in dieser Form nicht mehr gibt.
#
# Erwartet in der Umgebung: APPLE_API_KEY (Pfad zur .p8), APPLE_API_KEY_ID,
# APPLE_API_ISSUER. Läuft lokal (aus notarize-build.sh) wie auf dem CI-Runner.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# NUR die .dmg der Version, die gerade gebaut wurde. `dist/*.dmg` nahm alles,
# was je in dist/ liegen geblieben war: beim 0.11.0-Release lief die Schleife
# zuerst über eine 0.10.0-Datei von vorher, notarisierte sie ein zweites Mal
# (Minuten bei Apple), scheiterte dann daran, dass latest-mac.yml diese alte
# Version nicht kennt — und `set -e` brach ab, BEVOR die eigentliche 0.11.0-DMG
# an der Reihe war. Ergebnis war ein Release mit unsignierter, ungestapelter
# .dmg, das erst die Nachkontrolle auffliegen ließ.
VERSION="$(node -p 'require("./package.json").version')"
shopt -s nullglob
DMGS=( dist/*-"$VERSION"-*.dmg )
if [ ${#DMGS[@]} -eq 0 ]; then
  echo "::error::kein .dmg für Version $VERSION unter dist/ — wurde der Build ausgeführt?"
  exit 1
fi
echo "→ Version $VERSION: ${#DMGS[@]} .dmg zu verarbeiten"

: "${APPLE_API_KEY:?APPLE_API_KEY (Pfad zur .p8) fehlt}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID fehlt}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER fehlt}"

# app-builder liegt je Architektur getrennt bei; es erzeugt die Blockmap und
# liefert Größe und sha512 gleich mit zurück.
case "$(uname -m)" in
  arm64) APP_BUILDER="$ROOT/node_modules/app-builder-bin/mac/app-builder_arm64" ;;
  *)     APP_BUILDER="$ROOT/node_modules/app-builder-bin/mac/app-builder_amd64" ;;
esac

for DMG in "${DMGS[@]}"; do
  echo "→ $DMG: signieren, notarisieren, stapeln"
  codesign --sign "Developer ID Application" --timestamp --force "$DMG"
  xcrun notarytool submit "$DMG" \
    --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$DMG"

  echo "→ $DMG: Blockmap und Prüfsumme nachziehen"
  JSON="$("$APP_BUILDER" blockmap --input "$DMG" --output "$DMG.blockmap")"
  SHA="$(printf '%s' "$JSON" | sed -n 's/.*"sha512":"\([^"]*\)".*/\1/p')"
  SIZE="$(printf '%s' "$JSON" | sed -n 's/.*"size":\([0-9]*\).*/\1/p')"
  [ -n "$SHA" ] && [ -n "$SIZE" ] || { echo "::error::app-builder lieferte keine Prüfsumme"; exit 1; }

  # electron-builder schreibt in die yml den Namen MIT Bindestrichen statt
  # Leerzeichen (so lädt auch publish-release.sh hoch) — danach wird gesucht.
  URL="$(basename "$DMG" | tr ' ' '-')"
  for YML in dist/latest-mac.yml; do
    [ -f "$YML" ] || continue
    node -e '
      const fs = require("fs");
      const [yml, url, sha, size] = process.argv.slice(1);
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("(- url: " + esc + "\\n\\s*sha512: )[^\\n]+(\\n\\s*size: )\\d+");
      const before = fs.readFileSync(yml, "utf8");
      const after = before.replace(re, "$1" + sha + "$2" + size);
      if (after === before) {
        console.error("::error::" + yml + ": kein Eintrag für " + url + " gefunden");
        process.exit(1);
      }
      fs.writeFileSync(yml, after);
      console.log("  " + yml + ": Eintrag für " + url + " aktualisiert");
    ' "$YML" "$URL" "$SHA" "$SIZE"
  done

  echo "→ $DMG: Gegenprobe"
  xcrun stapler validate "$DMG"
  spctl -a -t open --context context:primary-signature -v "$DMG"
done

echo "✓ .dmg notarisiert, gestapelt und Metadaten konsistent."
