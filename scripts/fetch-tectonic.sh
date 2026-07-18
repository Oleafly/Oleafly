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
CACHE_DIR="${OPENLEAF_SIDECAR_CACHE_DIR:-$ROOT/src-tauri/target/e2e-sidecars}"
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

# Map a target triple to "<asset-name>:<archive-kind>". A `case` statement, not
# an associative array, so this runs on macOS's system bash 3.2 (GitHub's macOS
# runners use /bin/bash 3.2, which has no `declare -A`).
asset_for() {
  case "$1" in
    aarch64-apple-darwin)     echo "tectonic-$VERSION-aarch64-apple-darwin.tar.gz:tar:edb67c61aba768289f6da441c9e6f523cfaff4f8b2a5708523ef29c543f8e88e" ;;
    aarch64-unknown-linux-gnu) echo "tectonic-$VERSION-aarch64-unknown-linux-musl.tar.gz:tar:f9aa39017dbd51f111fdb93dda222178cbe51c8193508fc567b523cc74fff9c1" ;;
    x86_64-pc-windows-msvc)   echo "tectonic-$VERSION-x86_64-pc-windows-msvc.zip:zip:131a24604785a9600989a3d91225f597df52ac06f00aeffe86fd529f99ee5cdd" ;;
    x86_64-unknown-linux-gnu) echo "tectonic-$VERSION-x86_64-unknown-linux-musl.tar.gz:tar:60b13a0826ae7ad9ce34b4a2df06bff2cfcfa6dda8a915477c0cbb84e1a4a902" ;;
    *)                        echo "" ;;
  esac
}

ALL_TARGETS="aarch64-apple-darwin aarch64-unknown-linux-gnu x86_64-pc-windows-msvc x86_64-unknown-linux-gnu"

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
    echo "unknown target: $target" >&2
    exit 1
  fi
  local asset="${entry%%:*}"
  local rest="${entry#*:}"
  local kind="${rest%%:*}"
  local expected_sha="${rest##*:}"
  local ext=""
  [[ "$target" == *windows* ]] && ext=".exe"
  local out="$BIN_DIR/tectonic-$target$ext"
  local url="https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40$VERSION/$asset"
  TMP="$(mktemp -d)"
  local tmp="$TMP"
  local archive="$CACHE_DIR/$asset"
  # `-f` fails on an HTTP error (so a 404/redirect page can't masquerade as the
  # archive and make `tar` die with a confusing exit 2); `-S` surfaces the error
  # despite `-s`; `--retry` rides out transient network/rate-limit blips (the
  # release matrix pulls from GitHub from four jobs at once).
  local actual_sha=""
  if [[ -f "$archive" && ! -L "$archive" ]]; then
    actual_sha="$(checksum "$archive")"
  fi
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    rm -f "$archive"
    echo "→ fetching $target ($asset)"
    if ! curl -fSL --retry 5 --retry-delay 3 --retry-connrefused \
        -o "$tmp/download" "$url"; then
      echo "failed to download $url" >&2
      exit 1
    fi
    actual_sha="$(checksum "$tmp/download")"
    if [[ "$actual_sha" == "$expected_sha" ]]; then
      mv "$tmp/download" "$archive"
    fi
  fi
  if [[ "$actual_sha" != "$expected_sha" ]]; then
    echo "checksum mismatch for $asset: expected $expected_sha, got $actual_sha" >&2
    exit 1
  fi
  case "$kind" in
    tar)
      [[ "$(tar tzf "$archive" | grep -Ec '^tectonic$')" == "1" ]]
      local tar_entry
      tar_entry="$(tar tvzf "$archive" tectonic)"
      grep -E '^[-]' <<<"$tar_entry" >/dev/null
      tar xzf "$archive" -C "$tmp" tectonic
      ;;
    zip)
      [[ "$(unzip -Z1 "$archive" | grep -Ec '^tectonic\.exe$')" == "1" ]]
      unzip -oq "$archive" tectonic.exe -d "$tmp"
      ;;
  esac
  local bin="$tmp/tectonic$ext"
  if [[ ! -f "$bin" || -L "$bin" ]]; then
    echo "could not locate tectonic binary in archive for $target" >&2
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
  cp "$bin" "$out"
  chmod +x "$out"
  if [[ "$(uname)" == "Darwin" ]]; then
    xattr -d com.apple.quarantine "$out" 2>/dev/null || true
  fi
  cleanup_fetch
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
