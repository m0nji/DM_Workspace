#!/usr/bin/env bash
# Publish the freshly built electron-builder artifacts (in dist/) to the GitHub
# release for the current package.json version.
#
# Why this exists instead of `electron-builder --publish always`: GitHub's
# release API intermittently returns 504 (Gateway Time-out) on asset uploads,
# and electron-builder's own uploader neither retries the 504 nor overwrites an
# already-uploaded asset (it 422s with "already_exists" on the next attempt).
# That made every flaky upload leave a half-filled draft that blocked re-runs.
#
# This script decouples publishing from the build: it (re)creates a DRAFT
# release for the tag, then uploads every artifact with `gh release upload
# --clobber` (overwrites existing assets, so re-runs are idempotent) inside a
# retry loop (survives transient 504s). Runs identically on macOS, Linux and the
# Windows runner (invoked with `shell: bash`).
set -euo pipefail

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

# Collect the top-level release artifacts only (installers + blockmaps + the
# electron-updater metadata). Top-level globs skip the unpacked app dirs, and
# nullglob drops patterns that match nothing on a given platform. Plain globbing
# keeps this compatible with the macOS runner's bash 3.2 (no mapfile/find -print0).
shopt -s nullglob
RAW=( \
  dist/*.dmg dist/*.zip dist/*.exe dist/*.AppImage \
  dist/*.deb dist/*.rpm dist/*.snap \
  dist/*.blockmap dist/latest*.yml )

# electron-builder writes artifacts to disk with the (spaced) productName, e.g.
# "DM Workspace-0.7.4-arm64-mac.zip", but sanitizes spaces to hyphens for the
# URLs it records in latest*.yml ("DM-Workspace-..."). gh release upload keeps
# the on-disk name (and GitHub turns spaces into dots), which would NOT match the
# yml and break the auto-updater. So rename spaces to hyphens before upload,
# reproducing exactly what electron-builder's own uploader would have used.
FILES=()
for f in "${RAW[@]}"; do
  base="$(basename "$f")"
  safe="${base// /-}"
  if [ "$base" != "$safe" ]; then cp -f "$f" "dist/$safe"; f="dist/$safe"; fi
  FILES+=( "$f" )
done

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "::error::no release artifacts found in dist/"; exit 1
fi
printf 'Artifacts to upload:\n'; printf '  %s\n' "${FILES[@]}"

# Release notes: the CHANGELOG.md section for this version (so the in-app update
# dialog, which fetches the GitHub release body, shows the curated changes). The
# awk prints the lines after this version's "## <version>" heading up to the next
# "## " heading; falls back to a generic line if the section is missing.
BODY="$(awk -v ver="$VERSION" '
  /^## / { if (inSec) exit; if (index($0, ver)) { inSec=1; next } }
  inSec { print }
' CHANGELOG.md 2>/dev/null | sed '/^[[:space:]]*$/d')"
if [ -n "$BODY" ]; then
  NOTES="$(printf '## %s\n%s' "$VERSION" "$BODY")" # re-add heading so the parser groups entries
else
  NOTES="Automated release $VERSION"
fi

# Ensure a draft release exists for this tag. Idempotent: the first platform job
# creates it, later jobs (and re-runs) find it already there. The release is left
# as a DRAFT on purpose — a human reviews and publishes it so the auto-updater
# (which only sees published releases) gets a complete set of assets.
if ! gh release view "$TAG" >/dev/null 2>&1; then
  gh release create "$TAG" --draft --title "$TAG" --notes "$NOTES" || true
else
  # Keep notes in sync on re-runs (e.g. after a CHANGELOG edit) — otherwise only
  # the first job's notes would stick.
  gh release edit "$TAG" --notes "$NOTES" || true
fi

# Upload with --clobber so an asset left over from a half-finished prior attempt
# is overwritten rather than 422-ing. Retry the whole batch to ride out 504s.
ok=
for attempt in 1 2 3 4 5; do
  if gh release upload "$TAG" "${FILES[@]}" --clobber; then ok=1; break; fi
  echo "::warning::asset upload failed (attempt $attempt/5) — retrying in 30s"
  sleep 30
done
[ "$ok" = 1 ] || { echo "::error::asset upload failed after 5 attempts"; exit 1; }

echo "Published ${#FILES[@]} assets to draft release $TAG"
