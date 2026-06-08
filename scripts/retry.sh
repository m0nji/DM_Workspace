#!/usr/bin/env bash
# Run a command, retrying on failure. Used to wrap network-bound CI steps (npm
# ci, electron-builder) so GitHub's intermittent 504s on the electron-binary
# download don't sink the whole release job.
#
# Usage: bash scripts/retry.sh <command> [args...]
# Tunables (env): RETRY_N (attempts, default 5), RETRY_DELAY (seconds, default 30)
set -uo pipefail

n="${RETRY_N:-5}"
delay="${RETRY_DELAY:-30}"

for i in $(seq 1 "$n"); do
  if "$@"; then exit 0; fi
  echo "::warning::'$*' failed (attempt $i/$n)$([ "$i" -lt "$n" ] && echo " — retrying in ${delay}s")"
  [ "$i" -lt "$n" ] && sleep "$delay"
done

echo "::error::'$*' failed after $n attempts"
exit 1
