#!/usr/bin/env bash
#
# Fetch Tectonic sidecar binary(ies) for one or all Tauri target triples.
#   ./scripts/fetch-tectonic.sh aarch64-apple-darwin
#   ./scripts/fetch-tectonic.sh all
#
# Binaries land in src-tauri/binaries/tectonic-<triple>[.exe], which is where
# Tauri's `bundle.externalBin` expects them.
set -euo pipefail

VERSION="0.16.9"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="$ROOT/src-tauri/binaries"
mkdir -p "$BIN_DIR"

# Map a target triple to "<asset-name>:<archive-kind>". A `case` statement, not
# an associative array, so this runs on macOS's system bash 3.2 (GitHub's macOS
# runners use /bin/bash 3.2, which has no `declare -A`).
asset_for() {
  case "$1" in
    aarch64-apple-darwin)     echo "tectonic-$VERSION-aarch64-apple-darwin.tar.gz:tar" ;;
    x86_64-apple-darwin)      echo "tectonic-$VERSION-x86_64-apple-darwin.tar.gz:tar" ;;
    x86_64-pc-windows-msvc)   echo "tectonic-$VERSION-x86_64-pc-windows-msvc.zip:zip" ;;
    aarch64-pc-windows-msvc)  echo "tectonic-$VERSION-aarch64-pc-windows-msvc.zip:zip" ;;
    x86_64-unknown-linux-gnu) echo "tectonic-$VERSION-x86_64-unknown-linux-gnu.tar.gz:tar" ;;
    aarch64-unknown-linux-gnu) echo "tectonic-$VERSION-aarch64-unknown-linux-gnu.tar.gz:tar" ;;
    *)                        echo "" ;;
  esac
}

# Primary release matrix targets first; ARM Linux/Windows are best-effort when
# upstream publishes matching assets (fetch fails clearly if missing).
ALL_TARGETS="aarch64-apple-darwin x86_64-apple-darwin x86_64-pc-windows-msvc x86_64-unknown-linux-gnu aarch64-unknown-linux-gnu aarch64-pc-windows-msvc"

fetch() {
  local target="$1"
  local entry
  entry="$(asset_for "$target")"
  if [[ -z "$entry" ]]; then
    echo "unknown target: $target" >&2
    exit 1
  fi
  local asset="${entry%%:*}"
  local kind="${entry##*:}"
  local ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  local out="$BIN_DIR/tectonic-$target$ext"
  local url="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40$VERSION/$asset"
  local tmp
  tmp="$(mktemp -d)"
  echo "→ fetching $target ($asset)"
  # `-f` fails on an HTTP error (so a 404/redirect page can't masquerade as the
  # archive and make `tar` die with a confusing exit 2); `-S` surfaces the error
  # despite `-s`; `--retry` rides out transient network/rate-limit blips (the
  # release matrix pulls from GitHub from four jobs at once).
  if ! curl -fSL --retry 5 --retry-delay 3 --retry-connrefused \
      -o "$tmp/archive" "$url"; then
    echo "failed to download $url" >&2
    rm -rf "$tmp"
    exit 1
  fi
  if [[ ! -s "$tmp/archive" ]]; then
    echo "downloaded archive is empty: $url" >&2
    rm -rf "$tmp"
    exit 1
  fi
  case "$kind" in
    tar) tar xzf "$tmp/archive" -C "$tmp" ;;
    zip) (cd "$tmp" && unzip -oq archive) ;;
  esac
  local bin
  bin="$(find "$tmp" -maxdepth 2 -type f \( -name "tectonic" -o -name "tectonic.exe" \) | head -n1)"
  if [[ -z "$bin" ]]; then
    echo "could not locate tectonic binary in archive for $target" >&2
    rm -rf "$tmp"
    exit 1
  fi
  cp "$bin" "$out"
  chmod +x "$out"
  if [[ "$(uname)" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  rm -rf "$tmp"
  echo "✓ $out"
}

if [[ "$#" -eq 0 ]]; then
  echo "usage: $0 <target-triple> | all"
  echo "targets: $ALL_TARGETS"
  exit 0
fi

if [[ "$1" == "all" ]]; then
  for t in $ALL_TARGETS; do fetch "$t"; done
else
  fetch "$1"
fi
