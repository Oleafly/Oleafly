#!/usr/bin/env bash
#
# Print the CHANGELOG.md entry for a release, for use as the GitHub Release body
# and the updater's `notes` (what changed, not how to install).
#
# Usage:
#   ./scripts/changelog-extract.sh 0.2.0
#   ./scripts/changelog-extract.sh v0.2.0   # a leading "v" is stripped
#
# Emits the lines under `## [X.Y.Z]` up to (not including) the next `## `
# heading, with surrounding blank lines trimmed. When the version has no
# section, emits a short pointer to the changelog so the release still says
# something useful instead of failing.
set -euo pipefail

VERSION="${1:?usage: changelog-extract.sh <version>}"
VERSION="${VERSION#v}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="$ROOT/CHANGELOG.md"

section="$(
  awk -v ver="$VERSION" '
    $0 ~ ("^## \\[" ver "\\]") { cap = 1; next }
    cap && /^## / { exit }
    cap { print }
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

if [ -z "$section" ]; then
  echo "See the changelog: https://github.com/prajwal-svm/OpenLeaf/blob/main/CHANGELOG.md"
else
  printf '%s\n' "$section"
fi
