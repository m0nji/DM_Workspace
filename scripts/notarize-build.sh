#!/usr/bin/env bash
#
# Build, sign (Developer ID Application), notarize and staple the macOS app
# using an App Store Connect API key (.p8 + Key ID + Issuer ID).
#
# One-time setup:
#   cp build/.notarize.env.example build/.notarize.env
#   # then edit build/.notarize.env and point it at your .p8 key
#
# Run:
#   ./scripts/notarize-build.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/build/.notarize.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ Missing $ENV_FILE"
  echo "  Copy the template and fill in your API-key details:"
  echo "    cp build/.notarize.env.example build/.notarize.env"
  exit 1
fi

# Load credentials into the environment (electron-builder reads them).
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# Force the API-key path: if APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD are present
# (in the env file or the shell), electron-builder would use the password path
# instead of the API key. Remove them so the API key is always used.
unset APPLE_ID APPLE_APP_SPECIFIC_PASSWORD || true

: "${APPLE_API_KEY:?set APPLE_API_KEY (path to your .p8) in build/.notarize.env}"
: "${APPLE_API_KEY_ID:?set APPLE_API_KEY_ID in build/.notarize.env}"
: "${APPLE_API_ISSUER:?set APPLE_API_ISSUER in build/.notarize.env}"

if [[ ! -f "$APPLE_API_KEY" ]]; then
  echo "✗ APPLE_API_KEY points to a file that does not exist: $APPLE_API_KEY"
  echo "  Set it to the absolute path of your AuthKey_${APPLE_API_KEY_ID}.p8."
  exit 1
fi

echo "→ Confirming a Developer ID Application signing identity is available..."
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "✗ No 'Developer ID Application' certificate found in the keychain."
  echo "  Install it via Xcode → Settings → Accounts → Manage Certificates, or the Apple Developer portal."
  exit 1
fi

echo "→ Pre-flight: verifying the API key with Apple's notary service..."
# electron-builder/@electron/notarize hides the real notarytool error by trying to
# JSON.parse a plain-text "Error: HTTP ..." response. We query notarytool directly
# first so any auth/key problem surfaces with Apple's real message, fast.
if ! PREFLIGHT="$(xcrun notarytool history \
      --key "$APPLE_API_KEY" \
      --key-id "$APPLE_API_KEY_ID" \
      --issuer "$APPLE_API_ISSUER" 2>&1)"; then
  echo "✗ Notary API-key check FAILED. Apple's actual response:"
  echo "------------------------------------------------------------"
  echo "$PREFLIGHT"
  echo "------------------------------------------------------------"
  echo "Common causes:"
  echo "  • Wrong Key ID / Issuer ID, or the .p8 does not match the Key ID."
  echo "  • The key lacks the required role (needs at least 'Developer')."
  echo "  • A pending agreement must be accepted at App Store Connect / developer.apple.com."
  exit 1
fi
echo "✓ API key OK."

echo "→ Building, signing and notarizing. This can take several minutes..."
cd "$ROOT"
npm run dist:mac

echo ""
echo "→ Verifying the produced .app and .dmg ..."
APP_DIR="$(ls -d dist/mac*/*.app 2>/dev/null | head -1 || true)"
if [[ -n "${APP_DIR:-}" ]]; then
  echo "== codesign ==";        codesign --verify --deep --strict --verbose=2 "$APP_DIR" || true
  echo "== spctl ==";           spctl --assess --type execute --verbose "$APP_DIR" || true
  echo "== stapler (app) ==";   xcrun stapler validate "$APP_DIR" || true
else
  echo "  (no .app found under dist/ — check the build output above)"
fi

# Auch hier die Version festnageln statt „irgendein .dmg in dist/": sonst prüft
# die Nachkontrolle am Ende ein Altartefakt und meldet Erfolg für die falsche
# Datei (siehe Kommentar in staple-dmg.sh).
VERSION="$(node -p 'require("./package.json").version')"
DMG="$(ls dist/*-"$VERSION"-*.dmg 2>/dev/null | head -1 || true)"
if [[ -n "${DMG:-}" ]]; then
  # Das .dmg selbst signieren, notarisieren und stapeln — plus Blockmap und
  # latest-mac.yml nachziehen. Gemeinsames Skript, damit die CI (die
  # electron-builder direkt aufruft) denselben Schritt fahren kann.
  bash "$ROOT/scripts/staple-dmg.sh"

  echo "== stapler (dmg) ==";   xcrun stapler validate "$DMG" || true
  echo "== spctl (dmg) ==";     spctl -a -t open --context context:primary-signature -v "$DMG" || true
  echo ""
  echo "✓ Done: $DMG"
else
  echo "  (no .dmg found under dist/ — check the build output above)"
fi
