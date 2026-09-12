#!/usr/bin/env bash
# Unpack the archive produced by pack-windows-e2e-app.sh and point the e2e
# runner at the app through OLEAFLY_E2E_APP_BINARY.
# Usage: unpack-windows-e2e-app.sh <archive.tar.gz> <dest-dir>
set -euo pipefail

archive="${1:-}"
dest="${2:-}"
if [ -z "$archive" ] || [ -z "$dest" ]; then
  echo "usage: $0 <archive.tar.gz> <dest-dir>" >&2
  exit 2
fi
if [ ! -f "$archive" ]; then
  echo "unpack: $archive is missing" >&2
  exit 1
fi

mkdir -p "$dest"
tar -xzf "$archive" -C "$dest"

app=""
for candidate in "$dest"/*.exe; do
  [ -f "$candidate" ] || continue
  base="$(basename "$candidate" | tr '[:upper:]' '[:lower:]')"
  if [ "$base" = "oleafly.exe" ]; then
    app="$candidate"
  fi
done
if [ -z "$app" ]; then
  echo "unpack: no oleafly.exe inside $archive" >&2
  ls -la "$dest" >&2 || true
  exit 1
fi

app="$(cd "$(dirname "$app")" && pwd)/$(basename "$app")"
if command -v cygpath >/dev/null 2>&1; then
  app="$(cygpath -w "$app")"
fi
echo "OLEAFLY_E2E_APP_BINARY=$app" >> "${GITHUB_ENV:-/dev/null}"
echo "app binary: $app"
echo "--- unpacked into $dest ---"
ls -la "$dest" | sed -n '1,40p'
