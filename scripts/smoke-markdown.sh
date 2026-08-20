#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:?usage: smoke-markdown.sh <target-triple>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="3.9.0.2"
CACHE_DIR="${OLEAFLY_SIDECAR_CACHE_DIR:-$ROOT/src-tauri/target/e2e-sidecars}"
mkdir -p "$CACHE_DIR"
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
    KIND=zip; PANDOC="pandoc-$VERSION/pandoc.exe"; TECTONIC="src-tauri/binaries/tectonic-$TARGET.exe" ;;
  *) echo "unsupported Markdown smoke target: $TARGET" >&2; exit 1 ;;
esac

ARCHIVE="$CACHE_DIR/$ASSET"
if [[ ! -f "$ARCHIVE" ]] || [[ "$(checksum "$ARCHIVE")" != "$SHA" ]]; then
  rm -f "$ARCHIVE"
  curl -fSL --proto '=https' --connect-timeout 30 \
    --speed-limit 1024 --speed-time 60 \
    --retry 5 --retry-delay 3 --retry-connrefused \
    -o "$TMP/download" "https://mirrors.oleafly.com/binaries/pandoc/$VERSION/$ASSET" \
    || curl -fSL --proto '=https' --connect-timeout 30 \
      --speed-limit 1024 --speed-time 60 \
      --retry 5 --retry-delay 3 --retry-connrefused \
      -o "$TMP/download" "https://github.com/jgm/pandoc/releases/download/$VERSION/$ASSET"
  ACTUAL="$(checksum "$TMP/download")"
  if [[ "$ACTUAL" != "$SHA" ]]; then
    echo "checksum mismatch for $ASSET: expected $SHA, got $ACTUAL" >&2
    exit 1
  fi
  mv "$TMP/download" "$ARCHIVE"
fi
if [[ "$KIND" == tar ]]; then tar xzf "$ARCHIVE" -C "$TMP"; else unzip -q "$ARCHIVE" -d "$TMP"; fi
"$TMP/$PANDOC" --version | grep -F "pandoc $VERSION"
if [[ "$TARGET" == x86_64-pc-windows-msvc ]]; then
  ENGINE="$TMP/tectonic.exe"
  cp "$ROOT/$TECTONIC" "$ENGINE"
else
  ENGINE="$TMP/tectonic"
  ln -s "$ROOT/$TECTONIC" "$ENGINE"
fi
# Pull TeX packages from our own mirror instead of relay.fullyjustified.net,
# which rate-limits CI runners (HTTP 429). The retry loop stays as a guard for
# any remaining transient network failure.
BUNDLE_URL="${OLEAFLY_TEX_BUNDLE_URL:-https://mirrors.oleafly.com/tex-bundles/tlextras-2022.0r0.tar}"
attempt=1
until "$TMP/$PANDOC" --from=markdown --standalone \
  "--pdf-engine=$ENGINE" \
  --pdf-engine-opt=-b --pdf-engine-opt="$BUNDLE_URL" \
  --output="$TMP/smoke.pdf" -- \
  "$ROOT/scripts/fixtures/markdown-smoke.md"; do
  if [[ "$attempt" -ge 4 ]]; then
    echo "markdown smoke compile failed after $attempt attempts" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  echo "compile failed (transient bundle fetch?); attempt $attempt after 75s" >&2
  sleep 75
done
test -s "$TMP/smoke.pdf"
