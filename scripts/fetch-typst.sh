#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
typst_catalog() {
  (cd "$ROOT" && node scripts/typst/bundled-typst.mjs "$@")
}
VERSION="$(typst_catalog version)"
BIN_DIR="$ROOT/src-tauri/binaries"
CACHE_DIR="${OLEAFLY_SIDECAR_CACHE_DIR:-$ROOT/src-tauri/target/e2e-sidecars}"
mkdir -p "$BIN_DIR"
mkdir -p "$CACHE_DIR"
TMP=""

cleanup_fetch() {
  if [[ -n "$TMP" ]]; then
    rm -rf "$TMP"
    TMP=""
  fi
}
trap cleanup_fetch EXIT INT TERM

checksum() {
  local file="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$file" | awk '{print $1}'
  else
    shasum -a 256 "$file" | awk '{print $1}'
  fi
}

fetch() {
  local target="$1"
  local asset kind member expected binary_expected mirror_url url
  if ! read -r asset kind member expected binary_expected mirror_url url \
    < <(typst_catalog target "$target" 2>/dev/null); then
    echo "unsupported Typst target: $target" >&2
    exit 1
  fi
  local ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  local out="$BIN_DIR/typst-$target$ext"
  TMP="$(mktemp -d)"
  local tmp="$TMP"
  local archive="$CACHE_DIR/$asset"

  local actual
  actual=""
  if [[ -f "$archive" && ! -L "$archive" ]]; then
    actual="$(checksum "$archive")"
  fi
  if [[ "$actual" != "$expected" ]]; then
    rm -f "$archive"
    echo "fetching Typst $VERSION for $target ($asset)"
    # Mirror first, upstream fallback; the checksum pin keeps either origin honest.
    curl -fSL --proto '=https' --connect-timeout 30 \
      --speed-limit 1024 --speed-time 60 \
      --retry 5 --retry-delay 3 --retry-connrefused -o "$tmp/download" "$mirror_url" \
      || curl -fSL --proto '=https' --connect-timeout 30 \
        --speed-limit 1024 --speed-time 60 \
        --retry 5 --retry-delay 3 --retry-connrefused -o "$tmp/download" "$url"
    actual="$(checksum "$tmp/download")"
    if [[ "$actual" == "$expected" ]]; then
      mv "$tmp/download" "$archive"
    fi
  fi
  if [[ "$actual" != "$expected" ]]; then
    echo "Typst checksum mismatch for $asset" >&2
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    exit 1
  fi

  local bin="$tmp/typst$ext"
  case "$kind" in
    tar.xz) tar xJOf "$archive" "$member" > "$bin" ;;
    zip) unzip -p "$archive" "$member" > "$bin" ;;
    *) ;;
  esac
  if [[ ! -s "$bin" ]]; then
    echo "expected Typst binary is missing or empty: $member" >&2
    exit 1
  fi
  local binary_actual
  binary_actual="$(checksum "$bin")"
  if [[ "$binary_actual" != "$binary_expected" ]]; then
    echo "Typst binary checksum mismatch for $member" >&2
    echo "expected: $binary_expected" >&2
    echo "actual:   $binary_actual" >&2
    exit 1
  fi
  if [[ -f "$out" && ! -L "$out" ]] && cmp -s "$bin" "$out"; then
    chmod +x "$out"
    if [[ "$(uname)" == "Darwin" ]]; then
      xattr -d com.apple.quarantine "$out" 2>/dev/null || true
    fi
    cleanup_fetch
    echo "✓ $out"
    return
  fi
  rm -f "$out"
  cp "$bin" "$out"
  chmod +x "$out"
  if [[ "$(uname)" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  cleanup_fetch
  echo "installed $out"
}

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
