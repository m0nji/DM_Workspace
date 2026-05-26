#!/usr/bin/env bash
#
# Build, sign (Developer ID Application), notarize and staple the macOS app.
#
# One-time setup:
#   cp build/.notarize.env.example build/.notarize.env
#   # then edit build/.notarize.env and fill in your credentials
#
# Run:
#   ./scripts/notarize-build.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/build/.notarize.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ Missing $ENV_FILE"
  echo "  Copy the template and fill in your credentials:"
  echo "    cp build/.notarize.env.example build/.notarize.env"
  exit 1
fi

# Load credentials (exported into the environment for electron-builder + the afterSign hook).
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

: "${APPLE_ID:?set APPLE_ID in build/.notarize.env}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?set APPLE_APP_SPECIFIC_PASSWORD in build/.notarize.env}"
: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID in build/.notarize.env}"

echo "→ Confirming a Developer ID Application signing identity is available..."
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "✗ No 'Developer ID Application' certificate found in the keychain."
  echo "  Install it via Xcode → Settings → Accounts → Manage Certificates, or the Apple Developer portal."
  exit 1
fi

echo "→ Building, signing and notarizing (team $APPLE_TEAM_ID). This can take several minutes..."
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

DMG="$(ls dist/*.dmg 2>/dev/null | head -1 || true)"
if [[ -n "${DMG:-}" ]]; then
  echo "== stapler (dmg) ==";   xcrun stapler validate "$DMG" || true
  echo ""
  echo "✓ Done: $DMG"
else
  echo "  (no .dmg found under dist/ — check the build output above)"
fi
