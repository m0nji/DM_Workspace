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

# electron-builder reads the Team ID from package.json (build.mac.notarize.teamId);
# the notary service needs APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD from the environment.
: "${APPLE_ID:?set APPLE_ID in build/.notarize.env}"
: "${APPLE_APP_SPECIFIC_PASSWORD:?set APPLE_APP_SPECIFIC_PASSWORD in build/.notarize.env}"

echo "→ Confirming a Developer ID Application signing identity is available..."
if ! security find-identity -v -p codesigning | grep -q "Developer ID Application"; then
  echo "✗ No 'Developer ID Application' certificate found in the keychain."
  echo "  Install it via Xcode → Settings → Accounts → Manage Certificates, or the Apple Developer portal."
  exit 1
fi

TEAM_ID="${APPLE_TEAM_ID:-FLG4M553XP}"

echo "→ Pre-flight: verifying notary credentials with Apple (team $TEAM_ID)..."
# electron-builder/@electron/notarize hides the real notarytool error by trying to
# JSON.parse a plain-text "Error: HTTP ..." response. We query notarytool directly
# first so any auth/account problem surfaces with Apple's real message, fast.
if ! PREFLIGHT="$(xcrun notarytool history \
      --apple-id "$APPLE_ID" \
      --team-id "$TEAM_ID" \
      --password "$APPLE_APP_SPECIFIC_PASSWORD" 2>&1)"; then
  echo "✗ Notary credential check FAILED. Apple's actual response:"
  echo "------------------------------------------------------------"
  echo "$PREFLIGHT"
  echo "------------------------------------------------------------"
  echo "Common causes:"
  echo "  • APPLE_ID is not a member of team $TEAM_ID (the cert belongs to that team)."
  echo "  • The app-specific password was created under a DIFFERENT Apple ID."
  echo "  • A pending agreement must be accepted at developer.apple.com / App Store Connect."
  echo "  • Wrong/expired app-specific password (regenerate at appleid.apple.com)."
  exit 1
fi
echo "✓ Notary credentials OK."

echo "→ Building, signing and notarizing (team $TEAM_ID). This can take several minutes..."
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
