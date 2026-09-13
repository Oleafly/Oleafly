#!/usr/bin/env bash
set -euo pipefail

# Fetch the exact Pandoc release binary bundled with Oleafly. The archive is
# checksum-pinned and cached, while only the expected executable member is
# extracted into Tauri's externalBin directory.

VERSION="3.9.0.2"
LICENSE_SHA256="9d56cac92294e206af026a5502bee0fed77200b08b51ec28aa63c9efda4dcfdd"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
CACHE_DIR="${OLEAFLY_SIDECAR_CACHE_DIR:-$ROOT/src-tauri/target/e2e-sidecars}"
LICENSE_OUT="$ROOT/src-tauri/resources/licenses/pandoc-$VERSION-COPYING.md"
mkdir -p "$BIN_DIR" "$CACHE_DIR" "$(dirname "$LICENSE_OUT")"
TMP=""

cleanup_fetch() {
  if [[ -n "$TMP" ]]; then
    rm -rf "$TMP"
    TMP=""
  fi
}
trap cleanup_fetch EXIT INT TERM

asset_for() {
  case "$1" in
    aarch64-apple-darwin)
      echo "pandoc-$VERSION-arm64-macOS.zip|zip|6e9eca844076bcbb599bbeebbba78a70f93b5307782b85c2c272872812c88875|pandoc-$VERSION-arm64/bin/pandoc" ;;
    aarch64-unknown-linux-gnu)
      echo "pandoc-$VERSION-linux-arm64.tar.gz|tar|b6d21e8f9c3b15744f5a7ab40248019157ed7793875dbe0383d4c82ff572b528|pandoc-$VERSION/bin/pandoc" ;;
    x86_64-unknown-linux-gnu)
      echo "pandoc-$VERSION-linux-amd64.tar.gz|tar|a69abfababda8a56969a254b09f9553a7be89ddec00d4e0fe9fd585d71a67508|pandoc-$VERSION/bin/pandoc" ;;
    x86_64-pc-windows-msvc)
      echo "pandoc-$VERSION-windows-x86_64.zip|zip|c97542f2800f446e788d9f74237856d995421ad1bb3cc8324286840c5f272d3a|pandoc-$VERSION/pandoc.exe" ;;
    *) echo "" ;;
  esac
}

checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

stage_license() {
  local actual=""
  if [[ -f "$LICENSE_OUT" && ! -L "$LICENSE_OUT" ]]; then
    actual="$(checksum "$LICENSE_OUT")"
  fi
  if [[ "$actual" == "$LICENSE_SHA256" ]]; then
    return
  fi
  TMP="$(mktemp -d)"
  local tmp="$TMP"
  curl -fSL --proto '=https' --connect-timeout 30 \
    --speed-limit 1024 --speed-time 60 \
    --retry 5 --retry-delay 3 --retry-connrefused \
    -o "$tmp/COPYING.md" \
    "https://raw.githubusercontent.com/jgm/pandoc/$VERSION/COPYING.md"
  actual="$(checksum "$tmp/COPYING.md")"
  if [[ "$actual" != "$LICENSE_SHA256" ]]; then
    echo "Pandoc license checksum mismatch" >&2
    echo "expected: $LICENSE_SHA256" >&2
    echo "actual:   $actual" >&2
    exit 1
  fi
  mv "$tmp/COPYING.md" "$LICENSE_OUT"
  cleanup_fetch
}

fetch() {
  local target="$1"
  local entry
  entry="$(asset_for "$target")"
  if [[ -z "$entry" ]]; then
    echo "unsupported Pandoc target: $target" >&2
    exit 1
  fi

  local asset kind expected member
  IFS='|' read -r asset kind expected member <<<"$entry"
  local ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  local out="$BIN_DIR/pandoc-$target$ext"
  local archive="$CACHE_DIR/$asset"
  local mirror_url="https://mirrors.oleafly.com/binaries/pandoc/$VERSION/$asset"
  local upstream_url="https://github.com/jgm/pandoc/releases/download/$VERSION/$asset"
  TMP="$(mktemp -d)"
  local tmp="$TMP"

  local actual=""
  if [[ -f "$archive" && ! -L "$archive" ]]; then
    actual="$(checksum "$archive")"
  fi
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$archive"
    echo "fetching Pandoc $VERSION for $target ($asset)"
    curl -fSL --proto '=https' --connect-timeout 30 \
      --speed-limit 1024 --speed-time 60 \
      --retry 5 --retry-delay 3 --retry-connrefused -o "$tmp/download" "$mirror_url" \
      || curl -fSL --proto '=https' --connect-timeout 30 \
        --speed-limit 1024 --speed-time 60 \
        --retry 5 --retry-delay 3 --retry-connrefused -o "$tmp/download" "$upstream_url"
    actual="$(checksum "$tmp/download")"
    if [[ "$actual" == "$expected" ]]; then
      mv "$tmp/download" "$archive"
    fi
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "Pandoc checksum mismatch for $asset" >&2
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    exit 1
  fi

  local executable="$tmp/pandoc$ext"
  case "$kind" in
    tar)
      [[ "$(tar tzf "$archive" | grep -Fxc "$member")" == "1" ]]
      tar xOzf "$archive" "$member" > "$executable"
      ;;
    zip)
      [[ "$(unzip -Z1 "$archive" | grep -Fxc "$member")" == "1" ]]
      unzip -p "$archive" "$member" > "$executable"
      ;;
    *)
      echo "unknown Pandoc archive type: $kind" >&2
      exit 1
      ;;
  esac
  if [[ ! -s "$executable" ]]; then
    echo "expected Pandoc executable is missing or empty: $member" >&2
    exit 1
  fi

  if [[ -f "$out" && ! -L "$out" ]] && cmp -s "$executable" "$out"; then
    chmod +x "$out"
    if [[ "$(uname)" == "Darwin" ]]; then
      xattr -d com.apple.quarantine "$out" 2>/dev/null || true
    fi
    cleanup_fetch
    echo "✓ $out"
    return
  fi
  cp "$executable" "$out"
  chmod +x "$out"
  if [[ "$(uname)" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  cleanup_fetch
  echo "installed $out"
}

stage_license

case "${1:-}" in
  all)
    for target in aarch64-apple-darwin aarch64-unknown-linux-gnu x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do
      fetch "$target"
    done
    ;;
  "")
    echo "usage: $0 <target-triple> | all" >&2
    exit 1
    ;;
  *) fetch "$1" ;;
esac
