#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:?usage: fetch-quarto.sh <target triple> <folder>}"
DEST="${2:?usage: fetch-quarto.sh <target triple> <folder>}"
MANIFEST="$ROOT/src-tauri/resources/notebook-toolchains.json"

PINNED="$(python3 -I - "$MANIFEST" "$TARGET" <<'PY'
import json
import sys

target = json.load(open(sys.argv[1]))["tools"]["quarto"]["targets"][sys.argv[2]]
print(target["url"])
print(target["archiveSha256"])
for executable in target["executables"]:
    print(executable)
PY
)"
URL="$(sed -n 1p <<<"$PINNED")"
SHA="$(sed -n 2p <<<"$PINNED")"
EXECUTABLES="$(sed -n '3,$p' <<<"$PINNED")"

checksum() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

installed() {
  while IFS= read -r executable; do
    if [[ -x "$DEST/$executable" ]]; then
      echo "$DEST/$executable"
      return 0
    fi
  done <<<"$EXECUTABLES"
  return 1
}

if ! QUARTO="$(installed)"; then
  mkdir -p "$DEST"
  ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/quarto.XXXXXX")"
  trap 'rm -f "$ARCHIVE"' EXIT
  curl --fail --location --retry 3 --silent --show-error --output "$ARCHIVE" "$URL"
  ACTUAL="$(checksum "$ARCHIVE")"
  if [[ "$ACTUAL" != "$SHA" ]]; then
    echo "The Quarto archive does not match its pinned checksum: expected $SHA, got $ACTUAL" >&2
    exit 1
  fi
  tar -xzf "$ARCHIVE" -C "$DEST"
  if ! QUARTO="$(installed)"; then
    echo "The Quarto archive has none of the executables the manifest lists" >&2
    exit 1
  fi
fi

"$QUARTO" --version >&2
dirname "$QUARTO"
