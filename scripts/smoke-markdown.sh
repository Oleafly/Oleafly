#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?usage: smoke-markdown.sh <target-triple>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="3.9.0.2"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

case "$TARGET" in
  aarch64-apple-darwin)
    ASSET="pandoc-$VERSION-arm64-macOS.zip"
    SHA="6e9eca844076bcbb599bbeebbba78a70f93b5307782b85c2c272872812c88875"
    KIND=zip; PANDOC="pandoc-$VERSION-arm64/bin/pandoc"; TECTONIC="src-tauri/binaries/tectonic-$TARGET" ;;
  aarch64-unknown-linux-gnu)
    ASSET="pandoc-$VERSION-linux-arm64.tar.gz"
    SHA="b6d21e8f9c3b15744f5a7ab40248019157ed7793875dbe0383d4c82ff572b528"
    KIND=tar; PANDOC="pandoc-$VERSION/bin/pandoc"; TECTONIC="src-tauri/binaries/tectonic-$TARGET" ;;
  x86_64-unknown-linux-gnu)
    ASSET="pandoc-$VERSION-linux-amd64.tar.gz"
    SHA="a69abfababda8a56969a254b09f9553a7be89ddec00d4e0fe9fd585d71a67508"
    KIND=tar; PANDOC="pandoc-$VERSION/bin/pandoc"; TECTONIC="src-tauri/binaries/tectonic-$TARGET" ;;
  x86_64-pc-windows-msvc)
    ASSET="pandoc-$VERSION-windows-x86_64.zip"
    SHA="c97542f2800f446e788d9f74237856d995421ad1bb3cc8324286840c5f272d3a"
    KIND=zip; PANDOC="pandoc.exe"; TECTONIC="src-tauri/binaries/tectonic-$TARGET.exe" ;;
  *) echo "unsupported Markdown smoke target: $TARGET" >&2; exit 1 ;;
esac

curl -fSL --retry 5 --retry-delay 3 --retry-connrefused \
  -o "$TMP/archive" "https://github.com/jgm/pandoc/releases/download/$VERSION/$ASSET"
ACTUAL="$(checksum "$TMP/archive")"
test "$ACTUAL" = "$SHA"
if [[ "$KIND" == tar ]]; then tar xzf "$TMP/archive" -C "$TMP"; else unzip -q "$TMP/archive" -d "$TMP"; fi
"$TMP/$PANDOC" --version | grep -F "pandoc $VERSION"
if [[ "$TARGET" == x86_64-pc-windows-msvc ]]; then
  ENGINE="$TMP/tectonic.exe"
  cp "$ROOT/$TECTONIC" "$ENGINE"
else
  ENGINE="$TMP/tectonic"
  ln -s "$ROOT/$TECTONIC" "$ENGINE"
fi
"$TMP/$PANDOC" --from=markdown --standalone \
  "--pdf-engine=$ENGINE" --output="$TMP/smoke.pdf" -- \
  "$ROOT/scripts/fixtures/markdown-smoke.md"
test -s "$TMP/smoke.pdf"
