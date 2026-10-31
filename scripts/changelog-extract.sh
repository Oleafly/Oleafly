#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?usage: changelog-extract.sh <version>}"
VERSION="${VERSION#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="${OLEAFLY_CHANGELOG:-$ROOT/CHANGELOG.md}"

section="$(
  awk -v ver="$VERSION" '
    $0 ~ ("^## \\[" ver "\\]") { cap = 1; next }
    cap && /^## / { exit }
    cap && /^[[:space:]]*<\/?details([[:space:]][^>]*)?>[[:space:]]*$/ { dropped = 1; next }
    cap && dropped && /^[[:space:]]*$/ { dropped = 0; next }
    cap && /^[[:space:]]*<summary>.*<\/summary>[[:space:]]*$/ {
      line = $0
      sub(/^[[:space:]]*<summary>[[:space:]]*/, "", line)
      sub(/[[:space:]]*<\/summary>[[:space:]]*$/, "", line)
      print "**" line "**"
      dropped = 0
      next
    }
    cap { dropped = 0; print }
  ' "$CHANGELOG"
)"

# Trim leading/trailing blank lines without relying on tac (absent on macOS).
section="$(printf '%s\n' "$section" | awk '
  { line[NR] = $0 }
  END {
    start = 1; end = NR
    while (start <= end && line[start] ~ /^[[:space:]]*$/) start++
    while (end   >= start && line[end] ~ /^[[:space:]]*$/) end--
    for (i = start; i <= end; i++) print line[i]
  }
')"

if [[ -z "$section" ]]; then
  echo "See the changelog: https://github.com/Oleafly/Oleafly/blob/main/CHANGELOG.md"
else
  printf '%s\n' "$section"
fi
