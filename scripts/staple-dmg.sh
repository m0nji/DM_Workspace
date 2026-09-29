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
# Beide Architekturen: arm64 heißt "…-$VERSION-arm64.dmg", x64 schlicht
# "…-$VERSION.dmg". Nur das erste Muster zu suchen ließ das x64-.dmg seit
# 0.14.1 unsigniert und unnotarisiert (bei 0.19.4 per spctl nachgeprüft).
DMGS=( dist/*-"$VERSION".dmg dist/*-"$VERSION"-*.dmg )
if [ ${#DMGS[@]} -eq 0 ]; then
  echo "::error::kein .dmg für Version $VERSION unter dist/ — wurde der Build ausgeführt?"
  exit 1
fi
echo "→ Version $VERSION: ${#DMGS[@]} .dmg zu verarbeiten"

: "${APPLE_API_KEY:?APPLE_API_KEY (Pfad zur .p8) fehlt}"
: "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID fehlt}"
: "${APPLE_API_ISSUER:?APPLE_API_ISSUER fehlt}"

# Blockmap mit derselben Funktion erzeugen, die electron-builder selbst nutzt;
# sie liefert Größe und sha512 gleich mit zurück. Bis electron-builder 26.8 lag
# dafür das Go-Binary app-builder-bin bei, seit 26.15 ist es entfallen (0.19.4:
# der Release-Lauf brach hier mit "No such file or directory" ab).
BLOCKMAP_JS="$ROOT/node_modules/app-builder-lib/out/targets/blockmap/blockmap.js"
[ -f "$BLOCKMAP_JS" ] || { echo "::error::$BLOCKMAP_JS fehlt — hat electron-builder die Blockmap verlegt?"; exit 1; }

for DMG in "${DMGS[@]}"; do
  echo "→ $DMG: signieren, notarisieren, stapeln"
  codesign --sign "Developer ID Application" --timestamp --force "$DMG"
  xcrun notarytool submit "$DMG" \
    --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  xcrun stapler staple "$DMG"

  echo "→ $DMG: Blockmap und Prüfsumme nachziehen"
  JSON="$(node -e '
    const [js, input] = process.argv.slice(1);
    require(js).buildBlockMap(input, "gzip", input + ".blockmap")
      .then((r) => console.log(JSON.stringify(r)))
      .catch((e) => { console.error(e); process.exit(1); });
  ' "$BLOCKMAP_JS" "$DMG")"
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
