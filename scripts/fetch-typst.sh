#!/usr/bin/env bash
set -euo pipefail

VERSION="0.15.0"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

asset_for() {
  case "$1" in
    aarch64-apple-darwin)
      echo "typst-aarch64-apple-darwin.tar.xz:tar:fe53838737abf93a774495952a1a797b4686e9c4a21c2d99b9fdf77f46cc3572" ;;
    x86_64-pc-windows-msvc)
      echo "typst-x86_64-pc-windows-msvc.zip:zip:66ae7f0907b4b9afed5c7d6cb9b21e07f0f3c3d4e293ba3e0026a54d88202fe9" ;;
    x86_64-unknown-linux-gnu)
      echo "typst-x86_64-unknown-linux-musl.tar.xz:tar:59b207df01be2dab9f13e80f73d04d7ff8273ffd46b3dd1b9eef5c60f3eeabea" ;;
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

fetch() {
  local target="$1"
  local entry
  entry="$(asset_for "$target")"
  if [[ -z "$entry" ]]; then
    echo "unsupported Typst target: $target" >&2
    exit 1
  fi
  local asset="${entry%%:*}"
  local rest="${entry#*:}"
  local kind="${rest%%:*}"
  local expected="${rest##*:}"
  local ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  local out="$BIN_DIR/typst-$target$ext"
  local tmp
  tmp="$(mktemp -d)"
  local archive="$tmp/archive"
  local url="https://github.com/typst/typst/releases/download/v$VERSION/$asset"

  echo "fetching Typst $VERSION for $target ($asset)"
  curl -fSL --retry 5 --retry-delay 3 --retry-connrefused -o "$archive" "$url"
  local actual
  actual="$(checksum "$archive")"
  if [[ "$actual" != "$expected" ]]; then
    echo "Typst checksum mismatch for $asset" >&2
    echo "expected: $expected" >&2
    echo "actual:   $actual" >&2
    rm -rf "$tmp"
    exit 1
  fi

  local archive_root="${asset%.tar.xz}"
  archive_root="${archive_root%.zip}"
  local bin="$tmp/$archive_root/typst$ext"
  mkdir -p "$tmp/$archive_root"
  case "$kind" in
    tar) tar xJOf "$archive" "$archive_root/typst$ext" > "$bin" ;;
    zip) unzip -p "$archive" "$archive_root/typst$ext" > "$bin" ;;
  esac
  if [[ ! -f "$bin" || -L "$bin" ]]; then
    echo "expected Typst binary is missing or unsafe: $archive_root/typst$ext" >&2
    rm -rf "$tmp"
    exit 1
  fi
  cp "$bin" "$out"
  chmod +x "$out"
  if [[ "$(uname)" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  rm -rf "$tmp"
  echo "installed $out"
}

case "${1:-}" in
  all)
    for target in aarch64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu; do
      fetch "$target"
    done
    ;;
  "")
    echo "usage: $0 <target-triple> | all" >&2
    exit 1
    ;;
  *) fetch "$1" ;;
esac
